// @vitest-environment jsdom
import {expect, it, vi} from 'vitest';
import {StudyView} from '../src/study/view';
import type {StudyChange, StudyHost} from '../src/study/contracts';
import {MemoryStore} from '../src/core/store/memory-store';
import {extractStudyCards} from '../src/study/cards';
import {nextReview} from '../src/plugins/cloze/memory.plugin';
const entry = {id:'/a.md',title:'a.md',kind:'document' as const};
async function fixture() {
 const mount=document.createElement('div');document.body.append(mount);
 const store=new MemoryStore(),read=vi.fn(async()=>({content:'--alpha--',revision:'1'}));
 let notify!: (event:StudyChange)=>void;const stop=vi.fn();
 const host:StudyHost={list:async()=>[entry],read,store:()=>store,open:async()=>{},watch:listener=>{notify=listener;return stop;}};
 const view=new StudyView(mount,host);await view.flush();
 const card=extractStudyCards(entry,{content:'--alpha--',revision:'1'})[0];
 return {mount,store,read,view,stop,notify,card,async close(){await view.destroy();mount.remove();}};
}
it('coalesces committed updates without reading sources or replacing scope controls', async()=>{
 const f=await fixture();
 try {
  const check=f.mount.querySelector<HTMLInputElement>('[data-entry-id] input')!;
  check.click();const name=f.mount.querySelector('.mdx-study__file-link');
  f.mount.querySelector<HTMLButtonElement>('[aria-label="查看进度: a.md"]')!.click();
  await f.store.set('card:'+f.card.locator,nextReview(undefined,4));
  for(let i=0;i<5;i++)f.notify({type:'progress',documents:['/a.md']});
  await vi.waitFor(()=>expect(f.mount.querySelector('[data-entry-id]')!.textContent).toContain('已学 1'));
  expect(f.read).toHaveBeenCalledOnce();expect(f.mount.querySelector('.mdx-study__file-link')).toBe(name);
  expect(check.checked).toBe(false);expect(f.mount.querySelector<HTMLElement>('.mdx-study__inline-chart')!.hidden).toBe(false);
 } finally {await f.close();expect(f.stop).toHaveBeenCalledOnce();}
});
it('defers hidden updates and refreshes on activation including reset state', async()=>{
 const f=await fixture();
 try {
  f.mount.hidden=true;await f.store.set('card:'+f.card.locator,nextReview(undefined,4));f.notify({type:'progress'});
  await new Promise(resolve=>setTimeout(resolve,160));expect(f.mount.querySelector('[data-entry-id]')!.textContent).toContain('未学 1');
  f.mount.hidden=false;await f.view.refresh();expect(f.mount.querySelector('[data-entry-id]')!.textContent).toContain('已学 1');
  await f.store.remove('card:'+f.card.locator);f.notify({type:'progress'});
  await vi.waitFor(()=>expect(f.mount.querySelector('[data-entry-id]')!.textContent).toContain('未学 1'));
  expect(f.read).toHaveBeenCalledOnce();
 } finally {await f.close();}
});
it('retries failed progress reads on activation without discarding the previous snapshot', async()=>{
 const f=await fixture(),warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
 try {
  await f.store.set('card:'+f.card.locator,nextReview(undefined,4));
  const entries=vi.spyOn(f.store,'entries').mockRejectedValueOnce(Object.assign(new Error('IO failure'),{code:'EIO'}));
  f.notify({type:'progress'});await vi.waitFor(()=>expect(f.mount.querySelector('[role=status]')!.textContent).toContain('EIO'));
  expect(f.mount.querySelector('[data-entry-id]')!.textContent).toContain('未学 1');
  await f.view.refresh();expect(f.mount.querySelector('[data-entry-id]')!.textContent).toContain('已学 1');
  expect(entries.mock.calls.length).toBeLessThanOrEqual(4);expect(f.read).toHaveBeenCalledOnce();
 } finally {await f.close();warn.mockRestore();}
});
it('reindexes source changes but defers them until leaving a study session', async()=>{
 const f=await fixture();
 try {
  [...f.mount.querySelectorAll('button')].find(button=>button.textContent==='开始学习')!.click();
  f.notify({type:'sources'});await new Promise(resolve=>setTimeout(resolve,160));
  expect(f.read).toHaveBeenCalledOnce();expect(f.mount.querySelector('.mdx-study__question')).not.toBeNull();
  [...f.mount.querySelectorAll('button')].find(button=>button.textContent==='返回概览')!.click();
  await vi.waitFor(()=>expect(f.read).toHaveBeenCalledTimes(2));
 } finally {await f.close();}
});
