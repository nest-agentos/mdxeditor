import type {StudyCard, StudyEntry, StudyHost} from './contracts';
import type {ScopedPersistenceStore} from '../core/types';
import type {SRSCardState} from '../plugins/cloze/memory.plugin';
import {extractStudyCards, studyDue, studyStates} from './cards';
import {studyStep} from './operations';
import {readReviewEvents, type ReviewEvent} from '../plugins/cloze/review-history';

export interface StudyItem {card: StudyCard; state?: SRSCardState}
export interface StudyNode {entry: StudyEntry; children: StudyNode[]; documents: string[]; items: StudyItem[]}
export interface StudyCatalog {nodes: StudyNode[]; items: StudyItem[]; history: Map<string, ReviewEvent[]>}
/** Discover authored clozes independently of sparse review records. Never writes. */
export async function loadStudyCatalog(host: StudyHost, store: (id: string) => ScopedPersistenceStore,
    closed: () => boolean): Promise<StudyCatalog> {
    const visited = new Set<string>(), history = new Map<string, ReviewEvent[]>();
    async function read(entry: StudyEntry): Promise<StudyNode | undefined> {
        if (closed() || visited.has(entry.id)) return; visited.add(entry.id);
        if (entry.kind === 'directory') {
            const children = await list(entry.id);
            if (!children.length) return;
            return {entry, children, documents: children.flatMap(node => node.documents), items: children.flatMap(node => node.items)};
        }
        const source = await studyStep('source-read', () => host.read(entry.id));
        const cards = extractStudyCards(entry, source); if (!cards.length || closed()) return;
        const scoped = store(entry.id);
        const states = await studyStep('state-read', () => studyStates(scoped, cards));
        history.set(entry.id, await studyStep('history-read', () => readReviewEvents(scoped)));
        return {entry, children: [], documents: [entry.id], items: cards.map((card, i) => ({card, state: states[i]}))};
    }
    async function list(parent?: string): Promise<StudyNode[]> {
        const result: StudyNode[] = [];
        for (const entry of await studyStep('source-list', () => host.list(parent))) {
            if (closed()) break;
            const node = await read(entry); if (node) result.push(node);
        }
        return result;
    }
    const nodes = await list(); return {nodes, items: nodes.flatMap(node => node.items), history};
}
export function studyCounts(items: StudyItem[], now: number) {
    const learned = items.filter(item => !!item.state).length;
    const due = items.filter(item => item.state && studyDue(item.state, now)).length;
    return {total: items.length, learned, fresh: items.length - learned, due, scheduled: learned - due};
}

/** Refresh progress without reading or parsing document content. Apply only complete reads. */
export async function reloadStudyProgress(catalog: StudyCatalog, store: (id: string) => ScopedPersistenceStore, documents?: readonly string[]): Promise<void> {
    const selected = documents ? new Set(documents) : undefined, groups = new Map<string, StudyItem[]>();
    for (const item of catalog.items) {
        if (selected && !selected.has(item.card.document)) continue;
        const group = groups.get(item.card.document) ?? []; group.push(item); groups.set(item.card.document, group);
    }
    const values = await Promise.all([...groups].map(async ([id, items]) => {
        const scoped = store(id);
        const [states, events] = await Promise.all([
            studyStep('state-read', () => studyStates(scoped, items.map(item => item.card))),
            studyStep('history-read', () => readReviewEvents(scoped)),
        ]);
        return {id, items, states, events};
    }));
    for (const {id, items, states, events} of values) {
        items.forEach((item, index) => {item.state = states[index];}); catalog.history.set(id, events);
    }
}
