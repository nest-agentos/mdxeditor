// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { StudyView } from '../src/study/view';
import { extractStudyCards, studyState, studyStates } from '../src/study/cards';
import { nextReview } from '../src/plugins/cloze/memory.plugin';
import { MemoryStore } from '../src/core/store/memory-store';
import type { StudyHost } from '../src/study/contracts';
const entry = { id: '/a.md', title: 'a', kind: 'document' as const };
it('extracts authored clozes while excluding code and preserves editor identities', () => {
 const cards = extractStudyCards(entry, { content: 'A --alpha--.\n\n`--code--`\n\n```\n--fence--\n```\n\nB --beta--.', revision: '1' });
 expect(cards).toHaveLength(2); expect(cards[0].question).toContain('A […]');
 expect(extractStudyCards(entry, {content:'`--alpha--` --alpha--',revision:'1'})[0].question).toBe('`--alpha--` […]');
 expect(cards[0].legacy).toBe('auto-0'); expect(cards[1].legacy).toBe('auto-1');
});
it('does not write during scan or reveal; rejects stale sources and retries failed grades', async () => {
 const mount = document.createElement('div'), store = new MemoryStore(); document.body.append(mount);
 const set = vi.spyOn(store, 'set'), warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); let revision = '1';
 const host: StudyHost = { list: async () => [entry], read: async () => ({content:'A --alpha--.', revision}), store: () => store, open: async () => {} };
 const view = new StudyView(mount, host);
 const click = (label: string) => { const button = [...mount.querySelectorAll('button')].find(b => b.textContent!.startsWith(label)); expect(button).toBeTruthy(); button!.click(); };
 try {
  await view.flush(); click('全部笔记'); await view.flush(); expect(set).not.toHaveBeenCalled();
  click('开始学习'); click('显示答案'); expect(set).not.toHaveBeenCalled();
  revision = '2'; click('简单'); await view.flush(); expect(mount.textContent).toContain('文档已变化'); expect(set).not.toHaveBeenCalled();
  revision = '1'; set.mockRejectedValueOnce(new Error('write failed')); click('简单'); await view.flush();
  expect(warn).toHaveBeenLastCalledWith('[StudyView]', expect.objectContaining({stage:'state-write',code:'STATE_WRITE_FAILED',result:'failure'}));
  expect(mount.textContent).toContain('操作失败'); click('简单'); await view.flush();
  expect(set.mock.calls.at(-1)![1]).toMatchObject({ reviewCount: 1 }); expect(mount.textContent).toContain('本轮已完成');
 } finally { await view.destroy(); mount.remove(); warn.mockRestore(); }
});
it('uses positional legacy state consistently for scans and subsequent grades', async () => {
 const store = new MemoryStore(), cards = extractStudyCards(entry, {content:'--alpha--',revision:'1'});
 const previous = nextReview(undefined, 3, Date.UTC(2026,0,1));
 await store.set('card:auto-0', previous);
 expect(await studyState(store,cards[0])).toEqual(previous);
 expect(await studyStates(store,cards)).toEqual([previous]);
});
it('deduplicates overlapping directory and file selections and keeps practice read-only', async () => {
 const mount = document.createElement('div'), store = new MemoryStore(), read = vi.fn(async () => ({content:'--alpha--', revision:'1'}));
 const view = new StudyView(mount, { list: async parent => parent ? [entry] : [{id:'/dir',title:'dir',kind:'directory'},entry], read, store:()=>store, open:async()=>{} });
 const click = (label:string) => [...mount.querySelectorAll('button')].find(b=>b.textContent!.startsWith(label))!.click();
 try {
  await view.flush(); for (const check of mount.querySelectorAll<HTMLInputElement>('input')) {check.checked=true;check.dispatchEvent(new Event('change'));}
  expect(read).toHaveBeenCalledTimes(1);
  click('自由练习'); click('显示答案'); click('简单'); await view.flush(); expect(await store.entries()).toEqual([]);
 } finally {await view.destroy();}
});
it('requeues short-interval cards when due without counting them as a second unique card', async () => {
 vi.useFakeTimers(); let now = Date.UTC(2026,0,1);
 const mount = document.createElement('div'), store = new MemoryStore();
 const view = new StudyView(mount,{now:()=>now,list:async()=>[entry],read:async()=>({content:'--alpha--',revision:'1'}),store:()=>store,open:async()=>{}});
 const click = (label:string) => [...mount.querySelectorAll('button')].find(b=>b.textContent!.startsWith(label))!.click();
 try {
  await view.flush();click('全部笔记');await view.flush();click('开始学习');click('显示答案');click('忘记');await view.flush();
  expect(mount.textContent).toContain('等待下次复习');expect(mount.textContent).toContain('已处理 1/1');
  now+=60_000;await vi.advanceTimersByTimeAsync(60_000);expect(mount.textContent).toContain('显示答案');
  click('显示答案');click('简单');await view.flush();expect(mount.textContent).toContain('答题次数 2');expect(mount.textContent).toContain('已处理 1/1');
 } finally {await view.destroy();vi.useRealTimers();}
});
it('filters non-cloze files and empty folders, and propagates nested selection with mixed parents', async () => {
 const mount = document.createElement('div'), writes = vi.fn(), stores = new Map<string, MemoryStore>(); document.body.append(mount);
 const dir = (id:string) => ({id,title:id.split('/').pop()!,kind:'directory' as const});
 const file = (id:string) => ({id,title:id.split('/').pop()!,kind:'document' as const});
 const tree = new Map<string|undefined,ReturnType<typeof dir | typeof file>[]>([
  [undefined,[dir('/notes'),dir('/empty')]],['/notes',[file('/notes/a.md'),dir('/notes/nested'),file('/notes/plain.md')]],
  ['/notes/nested',[file('/notes/nested/b.md')]],['/empty',[file('/empty/code.md')]],
 ]);
 const view = new StudyView(mount,{list:async parent=>tree.get(parent)??[],
  read:async id=>({content:id.endsWith('a.md')||id.endsWith('b.md')?'--alpha--':'`--code--`',revision:'1'}),
  store:id=>{const store=new MemoryStore();stores.set(id,store);vi.spyOn(store,'set').mockImplementation(writes);return store;},open:async()=>{}});
 const check = (id:string) => mount.querySelector<HTMLInputElement>(`[data-entry-id="${id}"] input`)!;
 try {
  await view.flush(); expect(mount.textContent).not.toContain('plain.md');expect(mount.textContent).not.toContain('code.md');expect(mount.querySelector('[data-entry-id="/empty"]')).toBeNull();
  expect(stores.size).toBe(2);expect(writes).not.toHaveBeenCalled();
  check('/notes').click(); expect(check('/notes/a.md').checked).toBe(false);expect(check('/notes/nested/b.md').checked).toBe(false);
  expect([...mount.querySelectorAll('button')].find(b=>b.textContent==='开始学习')!.disabled).toBe(true);
  check('/notes').click();expect(check('/notes/nested').checked).toBe(true);expect(check('/notes/nested/b.md').checked).toBe(true);
  check('/notes/nested/b.md').click();expect(check('/notes').indeterminate).toBe(true);expect(check('/notes/nested').checked).toBe(false);
  expect(check('/notes/a.md').checked).toBe(true);
  [...mount.querySelectorAll('button')].find(b=>b.textContent==='取消全选')!.click();
  expect(mount.textContent).toContain('请选择要学习');expect(mount.querySelectorAll('input:checked')).toHaveLength(0);
 } finally {await view.destroy();mount.remove();}
});
it('shows total, studied, new and due counts per file and updates them after a successful grade', async () => {
 const mount=document.createElement('div'),store=new MemoryStore(),now=Date.UTC(2026,0,1);
 const content='--alpha--\n\n--beta--\n\n--gamma--',cards=extractStudyCards(entry,{content,revision:'1'});
 await store.set('card:'+cards[0].locator,nextReview(undefined,3,now-3*86400_000));
 await store.set('card:'+cards[1].locator,nextReview(undefined,4,now));
 const view=new StudyView(mount,{now:()=>now,list:async()=>[entry],read:async()=>({content,revision:'1'}),store:()=>store,open:async()=>{}});
 const click=(label:string)=>[...mount.querySelectorAll('button')].find(b=>b.textContent!.startsWith(label))!.click();
 const row=()=>mount.querySelector('[data-entry-id="/a.md"]')!;
 try {
  await view.flush();expect(row().textContent).toContain('总卡片 3');expect(row().textContent).toContain('已学 2');expect(row().textContent).toContain('未学 1');expect(row().textContent).toContain('待复习 1');
  click('开始学习');click('显示答案');click('简单');await view.flush();click('返回概览');
  expect(row().textContent).toContain('待复习 0');expect(row().textContent).toContain('已学 2');
  click('开始学习');click('显示答案');click('简单');await view.flush();click('返回概览');
  expect(row().textContent).toContain('全部已学');expect(row().textContent).toContain('已学 3');expect(row().querySelector('progress')!.value).toBe(3);
 } finally {await view.destroy();}
});
it('supports reveal and grading shortcuts without changing state during practice', async()=>{
 const mount=document.createElement('div'),store=new MemoryStore();document.body.append(mount);
 const view=new StudyView(mount,{list:async()=>[entry],read:async()=>({content:'--alpha--',revision:'1'}),store:()=>store,open:async()=>{}});
 try {
  await view.flush();[...mount.querySelectorAll('button')].find(b=>b.textContent==='自由练习（不记录）')!.click();
  const root=mount.querySelector('section')!;
  root.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true}));expect(mount.querySelector('.mdx-study__answer')?.textContent).toContain('alpha');
  root.dispatchEvent(new KeyboardEvent('keydown',{key:'3',bubbles:true}));await view.flush();expect(mount.textContent).toContain('本轮已完成');
  expect(await store.entries()).toEqual([]);
 } finally {await view.destroy();mount.remove();}
});
it('opens the file by name while only the checkbox changes the study selection', async () => {
 const mount=document.createElement('div'),store=new MemoryStore(),open=vi.fn(async()=>{});document.body.append(mount);
 const writes=vi.spyOn(store,'set'),warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
 const view=new StudyView(mount,{list:async()=>[entry],read:async()=>({content:'--alpha--',revision:'1'}),store:()=>store,open});
 try {
  await view.flush();const check=mount.querySelector<HTMLInputElement>('[data-entry-id="/a.md"] input')!;
  check.click();expect(check.checked).toBe(false);expect(open).not.toHaveBeenCalled();
  const name=mount.querySelector<HTMLButtonElement>('.mdx-study__file-link')!;
  name.click();expect(open).toHaveBeenCalledWith('/a.md');expect(check.checked).toBe(false);
  expect([...mount.querySelectorAll('button')].find(b=>b.textContent==='开始学习')!.disabled).toBe(true);
  open.mockRejectedValueOnce(Object.assign(new Error('Missing file'),{code:'ENOENT'}));name.click();
  await vi.waitFor(()=>expect(mount.querySelector('[role=status]')!.textContent).toContain('ENOENT'));
  expect(check.checked).toBe(false);expect(writes).not.toHaveBeenCalled();
  expect(warn).toHaveBeenLastCalledWith('[StudyView]',expect.objectContaining({operation:'study.open',stage:'source-open',code:'ENOENT'}));
 } finally {await view.destroy();mount.remove();warn.mockRestore();}
});
