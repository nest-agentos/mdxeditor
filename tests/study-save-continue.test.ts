// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createStudyDocument} from '../src/study/creation';
import {studyText} from '../src/study/locale';
import type {StudyCreation,StudyCreationState,StudyHost} from '../src/study/contracts';
const modal=Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype,'showModal'),close=Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype,'close');
let abort:AbortController;
beforeEach(()=>{abort=new AbortController();
 Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value(){this.open=true;}});
 Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value(){this.open=false;}});
});
afterEach(()=>{abort.abort();document.body.replaceChildren();vi.restoreAllMocks();
 for(const [key,value] of [['showModal',modal],['close',close]] as const){if(value)Object.defineProperty(HTMLDialogElement.prototype,key,value);else delete (HTMLDialogElement.prototype as any)[key];}
});
const folder={id:'opaque-folder',title:'Folder',kind:'directory' as const};
function fixture(extra:Partial<StudyCreation>={}){
 let cached:StudyCreationState|undefined;
 const draftStore={load:async()=>cached,save:vi.fn(async(state:StudyCreationState)=>{cached=structuredClone(state);}),clear:vi.fn(async()=>{cached=undefined;})};
 const save=vi.fn(async()=>({label:'Folder/result.md'}));
 const host={list:async()=>[],creation:{documents: {save: save}, generation: {generate: async()=> '--generated--'}, prompts: {defaultPrompt: 'Retained prompt'}, recovery: draftStore, ...extra}} as unknown as StudyHost;
 const pending=createStudyDocument(document.body,host,studyText('zh-CN'),abort.signal,folder);
 return {pending,save,draftStore,getCache:()=>cached};
}
function input(selector:string,value:string){const el=document.querySelector<HTMLInputElement|HTMLTextAreaElement>(selector)!;el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));}
function fill(name:string){input('dialog input[required]',name);input('.mdx-study-create__source textarea','Source');input('.mdx-study-create__draft textarea','--answer--');}
const submit=()=>document.querySelector('dialog form')!.dispatchEvent(new Event('submit',{cancelable:true}));
const status=()=>document.querySelector('dialog .mdx-study__status')!.textContent;
it('keeps fields until persistence succeeds, then clears work and saves the next item with a fresh identity',async()=>{
 let finish!:(result:{label:string})=>void;
 const save=vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValue({label:'Folder/second.md'});
 const f=fixture({documents: {save: save}});fill('first');submit();submit();
 await vi.waitFor(()=>expect(save).toHaveBeenCalledOnce());expect(status()).toBe('正在保存…');
 expect(document.querySelector<HTMLInputElement>('dialog input[required]')!.value).toBe('first');
 finish({label:'Folder/first.md'});await vi.waitFor(()=>expect(status()).toBe('已保存：Folder/first.md'));
 expect(document.querySelector('dialog')).not.toBeNull();expect(document.querySelector<HTMLInputElement>('dialog input[required]')!.value).toBe('');
 expect(document.querySelector<HTMLTextAreaElement>('.mdx-study-create__source textarea')!.value).toBe('');
 expect(document.querySelector<HTMLTextAreaElement>('.mdx-study-create__draft textarea')!.value).toBe('');
 expect(document.querySelector<HTMLTextAreaElement>('dialog textarea')!.value).toBe('Retained prompt');
 expect(document.querySelector<HTMLInputElement>('.mdx-study-destination input')!.value).toBe('Folder');
 expect(f.getCache()).toBeUndefined();expect(document.activeElement).toBe(document.querySelector('.mdx-study-create__source textarea'));
 fill('second');submit();await vi.waitFor(()=>expect(status()).toBe('已保存：Folder/second.md'));
 expect(save.mock.calls[0][0].operationId).not.toBe(save.mock.calls[1][0].operationId);expect(save.mock.calls[1][0].parent).toEqual(folder);
 expect(document.querySelector<HTMLButtonElement>('[aria-label="保存笔记"]')!.disabled).toBe(true);
});
it('keeps failed work and its identity for retry',async()=>{
 const save=vi.fn().mockRejectedValueOnce(Object.assign(new Error('disk full'),{code:'ENOSPC'})).mockResolvedValue({label:'Saved.md'});
 const f=fixture({documents: {save: save}});vi.spyOn(console,'warn').mockImplementation(()=>{});
 fill('Retry');submit();await vi.waitFor(()=>expect(status()).toContain('保存失败'));
 expect(status()).toContain('ENOSPC');expect(document.querySelector<HTMLInputElement>('dialog input[required]')!.value).toBe('Retry');
 expect(document.querySelector<HTMLTextAreaElement>('.mdx-study-create__draft textarea')!.value).toBe('--answer--');expect(f.draftStore.clear).not.toHaveBeenCalled();
 submit();await vi.waitFor(()=>expect(status()).toBe('已保存：Saved.md'));
 expect(save.mock.calls[0][0].operationId).toBe(save.mock.calls[1][0].operationId);expect(f.getCache()).toBeUndefined();
 expect([...document.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='关闭')!.disabled).toBe(false);
 document.querySelector<HTMLButtonElement>('[role=tab]')!.click();window.dispatchEvent(new Event('pagehide'));expect(f.getCache()).toBeUndefined();
});
it('shows saved status separately from a backup cleanup failure',async()=>{
 const f=fixture();f.draftStore.clear.mockRejectedValueOnce(Object.assign(new Error('denied'),{code:'EACCES'}));vi.spyOn(console,'warn').mockImplementation(()=>{});
 fill('Saved');submit();await vi.waitFor(()=>expect(status()).toBe('已保存：Folder/result.md'));
 expect(document.querySelector('dialog')?.textContent).toContain('旧草稿暂存清理失败');expect(f.save).toHaveBeenCalledOnce();
});
