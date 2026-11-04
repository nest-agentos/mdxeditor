import type {ScopedPersistenceStore} from '../../core/types';
import type {SRSCardState} from './memory.plugin';
import {clozeContentHash} from '../../renderer/worker-tokenizers';
import {randomUUID} from '../../utils/random';

export interface ReviewSnapshot {total: number; learned: number; signature: string}
export interface ReviewEvent extends ReviewSnapshot {id: string; at: number; grade: number; before: number}
export interface ReviewHistory {v: 1; events: ReviewEvent[]}
export function reviewSnapshot(locators: string[], learned: number): ReviewSnapshot {
    const ids = [...new Set(locators)].sort();
    return {total: ids.length, learned, signature: clozeContentHash(JSON.stringify(ids))};
}
function validEvent(value: unknown): value is ReviewEvent {
    if (!value || typeof value !== 'object') return false;
    const event = value as ReviewEvent;
    return typeof event.id === 'string' && Number.isFinite(event.at) && Number.isInteger(event.grade) && event.grade >= 1 && event.grade <= 4
        && Number.isInteger(event.total) && event.total > 0 && Number.isInteger(event.learned) && event.learned >= 0 && event.learned <= event.total
        && Number.isInteger(event.before) && event.before >= 0 && event.before <= event.total && typeof event.signature === 'string';
}
export function cardReviewEvents(value: unknown): ReviewEvent[] {
    if (!value || typeof value !== 'object') return [];
    const history = (value as {history?: ReviewHistory}).history;
    if (!history) return [];
    if (history.v !== 1 || !Array.isArray(history.events) || !history.events.every(validEvent))
        throw Object.assign(new Error('Unsupported review history'), {code: 'REVIEW_HISTORY_INVALID'});
    return history.events;
}
/** State and history share one payload, hence one host write, including legacy blob hosts. */
export function withReviewHistory(raw: unknown, state: SRSCardState, snapshot: ReviewSnapshot, previouslyLearned: boolean) {
    const previous = cardReviewEvents(raw), at = Date.parse(state.lastReviewedAt ?? '');
    if (!Number.isFinite(at)) throw Object.assign(new Error('Invalid review timestamp'), {code: 'REVIEW_TIMESTAMP_INVALID'});
    const event: ReviewEvent = {...snapshot, id: randomUUID(), at, grade: state.lastGrade!,
        before: snapshot.learned, learned: Math.min(snapshot.total, snapshot.learned + (previouslyLearned ? 0 : 1))};
    return {...state, history: {v: 1, events: [...previous, event]} satisfies ReviewHistory};
}
export async function readReviewEvents(store: ScopedPersistenceStore): Promise<ReviewEvent[]> {
    const raw = store.entries ? (await store.entries('card:')).map(([,value]) => value) : [];
    raw.push(...Object.values((await store.get('_mdx_srs') as Record<string, unknown>) ?? {}));
    const events = raw.flatMap(cardReviewEvents), unique = new Map(events.map(event => [event.id, event]));
    return [...unique.values()].sort((a, b) => a.at - b.at || a.learned - b.learned);
}
