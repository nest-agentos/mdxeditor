import type {ReviewEvent, ReviewSnapshot} from '../plugins/cloze/review-history';
export interface ProgressDocument {id: string; title: string; current: ReviewSnapshot; events: ReviewEvent[]}
export interface ProgressPoint {at: number; from: number; total: number; learned: number; answers: number; known: number; changed: boolean; current: boolean}
export type ProgressRange = 7 | 30 | 'all';
const dayStart = (time: number) => {const date = new Date(time); return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();};
function nextDay(time: number, count = 1): number {const date = new Date(time); date.setDate(date.getDate() + count); return date.getTime();}
/** Only recorded snapshots contribute to past points. Today uses the actual current card census. */
export function progressSeries(documents: ProgressDocument[], range: ProgressRange, now: number): ProgressPoint[] {
    if (!documents.length) return [];
    const histories = documents.map(document => document.events.filter(event => event.at <= now).sort((a, b) => a.at - b.at || a.learned - b.learned));
    const first = Math.min(now, ...histories.flatMap(events => events.length ? [events[0]!.at] : []));
    const start = range === 'all' ? dayStart(first) : nextDay(dayStart(now), 1 - range);
    const step = Math.max(1, Math.ceil((now - start) / 86400000 / 365));
    const indices = documents.map(() => 0), latest: Array<ReviewEvent | undefined> = documents.map(() => undefined);
    const result: ProgressPoint[] = [];
    for (let from = start; from <= now; from = nextDay(from, step)) {
        const cutoff = Math.min(now, nextDay(from, step) - 1), current = cutoff === now;
        const point = {at: cutoff, from, total: 0, learned: 0, answers: 0, known: 0, changed: false, current};
        documents.forEach((document, i) => {
            const events = histories[i]!;
            while (indices[i]! < events.length && events[indices[i]!]!.at <= cutoff) {
                const event = events[indices[i]!]!, previous = latest[i];
                if (event.at >= from) {point.answers++; if (previous && (previous.signature !== event.signature || previous.total !== event.total)) point.changed = true;}
                latest[i] = event; indices[i]!++;
            }
            const snapshot = current ? document.current : latest[i];
            if (snapshot) {point.total += snapshot.total; point.learned += snapshot.learned; point.known++;}
            if (current && latest[i] && (latest[i]!.signature !== document.current.signature || latest[i]!.total !== document.current.total)) point.changed = true;
        });
        if (point.known) result.push(point);
    }
    return result;
}
