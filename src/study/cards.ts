import { Marked } from 'marked';
import { lexicalExtension } from '../renderer/worker-tokenizers';
import type { StudyCard, StudyDocument, StudyEntry } from './contracts';
import { readStoredCard, type SRSCardState } from '../plugins/cloze/memory.plugin';
import type { ScopedPersistenceStore } from '../core/types';

/** Use the editor grammar, excluding fenced and inline code. */
export function extractStudyCards(entry: StudyEntry, document: StudyDocument): StudyCard[] {
    const parser = new Marked(lexicalExtension('cloze:cloze')), cards: StudyCard[] = [];
    for (const block of parser.lexer(document.content)) {
        let offset = 0;
        parser.walkTokens([block], token => {
            if (token.type !== 'cloze:cloze') {
                if (!('tokens' in token) && !('items' in token) && !('rows' in token)) {
                    const at = block.raw.indexOf(token.raw, offset);
                    if (at >= 0) offset = at + token.raw.length;
                }
                return;
            }
            const cloze = token as unknown as { raw: string; locator: string; legacyLocator?: string; content: string };
            const at = block.raw.indexOf(cloze.raw, offset); offset = at + cloze.raw.length;
            cards.push({ document: entry.id, title: entry.title, revision: document.revision, locator: cloze.locator,
                legacy: cloze.legacyLocator, question: block.raw.slice(0, at) + '[…]' + block.raw.slice(offset), answer: cloze.content });
        });
    }
    return cards;
}
export async function studyState(store: ScopedPersistenceStore, card: StudyCard): Promise<SRSCardState | undefined> {
    const current = readStoredCard(await store.get('card:' + card.locator));
    if (current) return current;
    const positional = card.legacy ? readStoredCard(await store.get('card:' + card.legacy)) : undefined;
    if (positional) return positional;
    const legacy = await store.get('_mdx_srs') as Record<string, unknown> | undefined;
    return readStoredCard(legacy?.[card.locator]) ?? readStoredCard(legacy?.[card.legacy ?? '']);
}
export function studyDue(state: SRSCardState | undefined, now: number): boolean {
    return !state || !state.dueAt || Date.parse(state.dueAt) <= now;
}

/** One enumeration per document keeps remote study scans bounded by document count. */
export async function studyStates(store: ScopedPersistenceStore, cards: StudyCard[]): Promise<Array<SRSCardState | undefined>> {
    if (!store.entries) return Promise.all(cards.map(card => studyState(store, card)));
    const [entries, old] = await Promise.all([store.entries('card:'), store.get('_mdx_srs')]);
    const values = new Map(entries), legacy = old as Record<string, unknown> | undefined;
    return cards.map(card => readStoredCard(values.get('card:' + card.locator))
        ?? readStoredCard(values.get('card:' + card.legacy))
        ?? readStoredCard(legacy?.[card.locator]) ?? readStoredCard(legacy?.[card.legacy ?? '']));
}
