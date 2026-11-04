// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {StudyView} from '../src/study/view';
import type {StudyCreation,StudyCreationState,StudyHost} from '../src/study/contracts';
import {MemoryStore} from '../src/core/store/memory-store';
const modal=Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype,'showModal'),close=Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype,'close');
const views:StudyView[]=[];
beforeEach(()=>{
 Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value(){this.open=true;}});
 Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value(){this.open=false;}});
});
afterEach(async()=>{for(const view of views.splice(0))await view.destroy();document.body.replaceChildren();vi.restoreAllMocks();
 for(const [key,value] of [['showModal',modal],['close',close]] as const){if(value)Object.defineProperty(HTMLDialogElement.prototype,key,value);else delete (HTMLDialogElement.prototype as any)[key];}
});
function fixture(extra:Partial<StudyCreation>={}){
 let state:StudyCreationState|undefined;
 const draftStore={load:vi.fn(async()=>state),save:vi.fn(async(value:StudyCreationState)=>{state=structuredClone(value);}),clear:vi.fn(async()=>{state=undefined;})};
 const save=vi.fn(async()=>{}),host:StudyHost={list:async()=>[],read:async()=>({content:'',revision:'1'}),store:()=>new MemoryStore(),open:async()=>{},creation:{documents: {save: save}, generation: {generate: async()=> '--generated--'}, prompts: {defaultPrompt: 'Default'}, recovery: draftStore, ...extra}};
 const open=()=>{const mount=document.createElement('div');document.body.append(mount);const view=new StudyView(mount,host);views.push(view);return view;};
 return {draftStore,save,open,getState:()=>state,setState:(value:StudyCreationState)=>{state=value;}};
}
const click=(label:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent===label)!.click();
function input(selector:string,value:string){const field=document.querySelector<HTMLInputElement|HTMLTextAreaElement>(selector)!;field.value=value;field.dispatchEvent(new Event('input',{bubbles:true}));}
it('checkpoints source, prompt, title and edited content and restores them after interruption',async()=>{
 const f=fixture(),first=f.open();await first.flush();click('新增笔记');
 input('dialog input[required]','Unfinished');input('.mdx-study-create__source textarea','Source draft');input('.mdx-study-create__draft textarea','Edited --answer--');
 input('dialog textarea','Custom prompt');
 await vi.waitFor(()=>expect(f.getState()).toMatchObject({title:'Unfinished',source:'Source draft',prompt:'Custom prompt',content:'Edited --answer--'}));
 const id=f.getState()!.draftId;window.dispatchEvent(new Event('pagehide'));await first.destroy();
 const second=f.open();await second.flush();await vi.waitFor(()=>expect(document.querySelector<HTMLInputElement>('dialog input[required]')?.value).toBe('Unfinished'));
 expect(document.querySelector<HTMLTextAreaElement>('.mdx-study-create__draft textarea')!.value).toBe('Edited --answer--');expect(f.getState()!.draftId).toBe(id);expect(f.save).not.toHaveBeenCalled();
 click('关闭');await vi.waitFor(()=>expect(f.getState()).toBeUndefined());
 const third=f.open();await third.flush();expect(document.querySelector('dialog')).toBeNull();
});
it('clears recovery on an explicit close or after saving a note',async()=>{
 const f=fixture(),view=f.open();await view.flush();click('新增笔记');input('.mdx-study-create__draft textarea','--answer--');
 await vi.waitFor(()=>expect(f.getState()?.content).toBe('--answer--'));
 document.querySelector('dialog')!.dispatchEvent(new Event('cancel',{cancelable:true}));await vi.waitFor(()=>expect(f.getState()).toBeUndefined());
 click('新增笔记');input('dialog input[required]','Saved');input('.mdx-study-create__draft textarea','--answer--');
 document.querySelector('dialog form')!.dispatchEvent(new Event('submit',{cancelable:true}));
 await vi.waitFor(()=>expect(f.save).toHaveBeenCalledOnce());await vi.waitFor(()=>expect(f.getState()).toBeUndefined());
});
it('resumes the original operation after interruption without generating another request',async()=>{
 const generate=vi.fn(async()=> '--wrong--'),resumeGeneration=vi.fn(async()=> '--recovered--'),f=fixture({generation: {generate: generate, resume: resumeGeneration}});
 f.setState({version:1,draftId:'stable-draft',title:'Pending',source:'Source',prompt:'Prompt',content:'Old text',generated:'Old text',pendingOperationId:'original-op'});
 const view=f.open();await view.flush();
 await vi.waitFor(()=>expect(document.querySelector<HTMLTextAreaElement>('.mdx-study-create__draft textarea')?.value).toBe('--recovered--'));
 expect(generate).not.toHaveBeenCalled();expect(resumeGeneration).toHaveBeenCalledWith(expect.objectContaining({draftId:'stable-draft',operationId:'original-op'}));
 await vi.waitFor(()=>expect(f.getState()?.pendingOperationId).toBeUndefined());expect(f.save).not.toHaveBeenCalled();
});
it('keeps editing usable and reports checkpoint failures without logging draft text',async()=>{
 const warn=vi.spyOn(console,'warn').mockImplementation(()=>{}),f=fixture();
 f.draftStore.save.mockRejectedValueOnce(new Error('sensitive source body'));
 const view=f.open();await view.flush();click('新增笔记');input('.mdx-study-create__draft textarea','private --draft--');
 await vi.waitFor(()=>expect(document.querySelector('dialog')?.textContent).toContain('草稿暂存或恢复失败'));
 expect(document.querySelector<HTMLTextAreaElement>('.mdx-study-create__draft textarea')?.value).toBe('private --draft--');
 expect(JSON.stringify(warn.mock.calls)).not.toContain('sensitive source body');expect(JSON.stringify(warn.mock.calls)).not.toContain('private --draft--');
});

it('retains a host-declared pending result and resumes the same operation on retry',async()=>{
 const generate=vi.fn(async()=>{throw Object.assign(new Error('Pending'),{code:'CUSTOM_RESULT_WAIT',recovery:'pending'});});
 const resume=vi.fn(async()=> '--recovered--'),f=fixture({generation:{generate,resume}});
 vi.spyOn(console,'warn').mockImplementation(()=>{});
 const view=f.open();await view.flush();click('新增笔记');
 const source=document.querySelector<HTMLTextAreaElement>('[aria-label="待处理内容"]')!;
 source.value='Source';source.dispatchEvent(new Event('input',{bubbles:true}));click('生成草稿');
 await vi.waitFor(()=>expect(f.getState()?.pendingOperationId).toBeTruthy());
 await vi.waitFor(()=>expect(document.querySelector('dialog')!.textContent).toContain('CUSTOM_RESULT_WAIT'));
 const operationId=f.getState()!.pendingOperationId;click('生成草稿');
 await vi.waitFor(()=>expect(document.querySelector<HTMLTextAreaElement>('.mdx-study-create__draft textarea')!.value).toBe('--recovered--'));
 expect(generate).toHaveBeenCalledOnce();expect(resume).toHaveBeenCalledWith(expect.objectContaining({operationId}));
});

it('cancels execution on explicit close and only stops observation on page suspension',async()=>{
 const cancel=vi.fn(async()=>{}),generate=vi.fn(()=>new Promise<string>(()=>{}));
 const f=fixture({generation:{generate,cancel}});const view=f.open();await view.flush();click('新增笔记');
 const source=document.querySelector<HTMLTextAreaElement>('[aria-label="待处理内容"]')!;
 source.value='Source';source.dispatchEvent(new Event('input',{bubbles:true}));click('生成草稿');
 await vi.waitFor(()=>expect(generate).toHaveBeenCalledOnce());const operationId=f.getState()!.pendingOperationId;
 window.dispatchEvent(new Event('pagehide'));await view.destroy();
 expect(generate.mock.calls[0][0].signal.aborted).toBe(true);expect(cancel).not.toHaveBeenCalled();
 expect(f.getState()?.pendingOperationId).toBe(operationId);
 window.dispatchEvent(new Event('pageshow'));const reopened=f.open();await reopened.flush();
 await vi.waitFor(()=>expect(document.querySelector('dialog')).not.toBeNull());click('关闭');
 await vi.waitFor(()=>expect(cancel).toHaveBeenCalledWith(expect.objectContaining({operationId})));
});
