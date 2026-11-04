import type {StudyChange} from './contracts';

/** Merge invalidations; source changes supersede state-only updates. */
export function mergeStudyChange(previous: StudyChange | undefined, next: StudyChange): StudyChange {
    if (!previous) return next;
    if (previous.type === 'sources' || next.type === 'sources') return {type: 'sources'};
    return previous.documents && next.documents ? {type: 'progress', documents: [...new Set([...previous.documents, ...next.documents])]}
        : {type: 'progress'};
}
