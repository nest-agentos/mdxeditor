import type {ScopedPersistenceStore} from '../core/types';
import type {StudyItem} from './catalog';
import {studyStates} from './cards';
import {nextReview, SRS_STORAGE_VERSION} from '../plugins/cloze/memory.plugin';
import {readReviewEvents, reviewSnapshot, withReviewHistory} from '../plugins/cloze/review-history';
import {studyStep} from './operations';

export async function saveStudyReview(store: ScopedPersistenceStore, item: StudyItem, document: StudyItem[], grade: number, now: number) {
    const states = await studyStep('state-read', () => studyStates(store, document.map(value => value.card)));
    const previous = states[document.indexOf(item)], next = nextReview(previous, grade, now);
    const snapshot = reviewSnapshot(document.map(value => value.card.locator), states.filter(Boolean).length);
    const blob = store.entries ? undefined : await studyStep('state-read', () => store.get('_mdx_srs')) as Record<string, unknown> | undefined;
    const raw = store.entries ? await studyStep('history-read', () => store.get('card:' + item.card.locator)) : blob?.[item.card.locator];
    const history = await studyStep('history-read', () => readReviewEvents(store));
    const payload = {v: SRS_STORAGE_VERSION, ...withReviewHistory(raw, next, snapshot, !!previous)};
    await studyStep('state-write', () => store.entries ? store.set('card:' + item.card.locator, payload)
        : store.set('_mdx_srs', {...blob, [item.card.locator]: payload}));
    states[document.indexOf(item)] = next;
    return {states, events: [...new Map([...history, ...payload.history.events].map(event => [event.id, event])).values()]};
}
