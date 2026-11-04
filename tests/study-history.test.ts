// @vitest-environment jsdom
import {expect, it, vi} from 'vitest';
import {MemoryStore} from '../src/core/store/memory-store';
import {nextReview} from '../src/plugins/cloze/memory.plugin';
import {cardReviewEvents, readReviewEvents, reviewSnapshot, withReviewHistory, type ReviewEvent} from '../src/plugins/cloze/review-history';
import {extractStudyCards} from '../src/study/cards';
import {saveStudyReview} from '../src/study/review';
import {progressSeries, type ProgressDocument} from '../src/study/progress-data';
import {progressChart} from '../src/study/chart';
import {studyText} from '../src/study/locale';
const day = (offset: number) => new Date(2026, 0, 1 + offset, 12).getTime();
const event = (offset: number, total: number, learned: number, signature = 'same'): ReviewEvent =>
    ({id: `${offset}-${total}-${learned}`, at: day(offset), grade: 3, before: learned - 1, learned, total, signature});
const document = (id: string, total: number, learned: number, events: ReviewEvent[] = []): ProgressDocument =>
    ({id, title: id, current: {total, learned, signature: 'same'}, events});

it('merges coverage by card totals, counts repeated answers and keeps missing history explicit', () => {
    const documents = [document('a', 2, 2, [event(0,2,1), event(1,2,2), {...event(1,2,2),id:'repeat'}]), document('b',8,1,[event(1,8,1)])];
    const points = progressSeries(documents,7,day(2));
    expect(points).toHaveLength(3); expect(points[0]).toMatchObject({learned:1,total:2,known:1,answers:1});
    expect(points[1]).toMatchObject({learned:3,total:10,known:2,answers:3});
    expect(points[2]).toMatchObject({learned:3,total:10,known:2,answers:0,current:true});
    expect(progressSeries([documents[0]],30,day(2)).at(-1)).toMatchObject({learned:2,total:2});
});
it('does not fabricate historical points for legacy progress and marks changed card sets', () => {
    expect(progressSeries([document('legacy',10,4)],30,day(10))).toEqual([expect.objectContaining({learned:4,total:10,current:true,answers:0})]);
    const points=progressSeries([document('a',3,1,[event(0,2,1)])],'all',day(2));
    expect(points.at(-1)).toMatchObject({learned:1,total:3,changed:true});
    expect(progressSeries([],7,day(2))).toEqual([]);
});
it('bounds long histories and includes prior snapshots without counting out-of-range reviews', () => {
    const points=progressSeries([document('a',2,1,[event(0,2,1)])],'all',day(1000));
    expect(points.length).toBeLessThanOrEqual(366);
    expect(points.reduce((sum,point)=>sum+point.answers,0)).toBe(1);
    expect(progressSeries([document('a',2,1,[event(0,2,1)])],7,day(1000))[0]).toMatchObject({learned:1,answers:0});
});
it('commits state and history together, retries safely and works without store enumeration', async () => {
    const store=new MemoryStore(),entry={id:'/a.md',title:'a',kind:'document' as const};
    const items=extractStudyCards(entry,{content:'--alpha--\n\n--beta--',revision:'1'}).map(card=>({card,state:undefined}));
    const set=vi.spyOn(store,'set').mockRejectedValueOnce(new Error('disk error'));
    await expect(saveStudyReview(store,items[0],items,3,day(0))).rejects.toThrow('state-write');
    expect(await store.entries()).toEqual([]);
    await saveStudyReview(store,items[0],items,3,day(0)); await saveStudyReview(store,items[0],items,4,day(1));
    expect(set).toHaveBeenCalledTimes(3);
    const events=await readReviewEvents(store); expect(events).toHaveLength(2); expect(events.map(e=>e.learned)).toEqual([1,1]);
    expect(events[0]).toMatchObject({before:0,total:2}); expect(events[1]).toMatchObject({before:1,total:2});
    const fallback={get:store.get.bind(store),set:store.set.bind(store),remove:store.remove.bind(store)};
    await saveStudyReview(fallback,items[1],items,4,day(2));
    expect(await readReviewEvents(fallback)).toEqual([expect.objectContaining({learned:2,total:2})]);
});
it('rejects unsupported history instead of overwriting it and records only metadata', () => {
    const state=nextReview(undefined,3,day(0));
    expect(()=>withReviewHistory({history:{v:2,events:[]}},state,reviewSnapshot(['alpha'],0),false)).toThrow('Unsupported review history');
    const payload=withReviewHistory(undefined,state,reviewSnapshot(['private-content-locator'],0),false);
    expect(JSON.stringify(payload)).not.toContain('private-content'); expect(cardReviewEvents(payload)).toHaveLength(1);
});
it('offers accessible range inspection and activity controls without changing scope', () => {
    const chart=progressChart([document('a',2,1,[event(0,2,1)])],day(2),studyText('zh-CN'),'zh-CN');
    const slider=chart.querySelector<HTMLInputElement>('input[type=range]')!;
    expect(slider.getAttribute('aria-valuetext')).toContain('1/2');slider.value='0';slider.dispatchEvent(new Event('input'));
    expect(chart.querySelector('output')!.textContent).toContain('复习次数 1');
    [...chart.querySelectorAll('button')].find(button=>button.textContent==='复习记录')!.click();
    expect(chart.querySelectorAll('.mdx-study__chart-bar')).toHaveLength(3);
    [...chart.querySelectorAll('button')].find(button=>button.textContent==='7 天')!.click();
    expect(chart.querySelector('[aria-pressed=true]')!.textContent).toBe('7 天');
});
