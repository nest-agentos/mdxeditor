// @vitest-environment jsdom
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {createStudyDocument} from '../src/study/creation';
import {StudyView} from '../src/study/view';
import {studyText} from '../src/study/locale';
import {MemoryStore} from '../src/core/store/memory-store';
import type {StudyHost} from '../src/study/contracts';
const modal=Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype,'showModal'),close=Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype,'close');
beforeEach(()=>{
 Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value(){this.open=true;}});
 Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value(){this.open=false;}});
});
afterEach(()=>{
 vi.restoreAllMocks();document.body.replaceChildren();
 if(modal)Object.defineProperty(HTMLDialogElement.prototype,'showModal',modal);else delete (HTMLDialogElement.prototype as any).showModal;
 if(close)Object.defineProperty(HTMLDialogElement.prototype,'close',close);else delete (HTMLDialogElement.prototype as any).close;
});
const entry={id:'/source.md',title:'source.md',kind:'document' as const};
const host=(creation:StudyHost['creation']):StudyHost=>({list:async()=>[entry],read:async()=>({content:'original source',revision:'1'}),store:()=>new MemoryStore(),open:async()=>{},creation});
const click=(label:string)=>{document.querySelector('form')?.dispatchEvent(new Event('input',{bubbles:true})); [...document.querySelectorAll('button')].find(button=>button.textContent===label)!.click();};
it('offers creation in an empty library and only persists on explicit save',async()=>{
 const save=vi.fn(async()=>{}),mount=document.createElement('div');document.body.append(mount);
 const view=new StudyView(mount,host({documents: {save: save}}));
 try {
  await view.flush();click('新增笔记');expect(document.querySelector('dialog')).not.toBeNull();expect(save).not.toHaveBeenCalled();
  document.querySelector<HTMLInputElement>('dialog input[required]')!.value='new';
  document.querySelector<HTMLTextAreaElement>('.mdx-study-create__draft textarea')!.value='pasted --cloze--';
  document.querySelector('dialog form')!.dispatchEvent(new Event('submit',{cancelable:true}));
  await vi.waitFor(()=>expect(document.querySelector('dialog')?.textContent).toContain('已保存：new'));
  expect(document.querySelector<HTMLInputElement>('dialog input[required]')!.value).toBe('');
  expect(save).toHaveBeenCalledWith(expect.objectContaining({title:'new',content:'pasted --cloze--',operationId:expect.any(String)}));
 } finally {await view.destroy();}
});
it('retains prompt and edited draft across generation failures, requires replacement consent, and cancels without saving',async()=>{
 const generate=vi.fn().mockResolvedValueOnce('--draft one--').mockRejectedValueOnce(Object.assign(new Error('Network failed'),{code:'NETWORK_FAILED'})).mockResolvedValueOnce('--draft two--');
 const save=vi.fn(async()=>{}),abort=new AbortController(),warning=vi.spyOn(console,'warn').mockImplementation(()=>{});
 const pending=createStudyDocument(document.body,host({documents: {save: save}, generation: {generate: generate}}),studyText('zh-CN'),abort.signal);
 const fields=[...document.querySelectorAll<HTMLTextAreaElement>('textarea')],prompt=fields[0],source=fields[1],draft=fields[2];
 prompt.value='first prompt';source.value='pasted input';click('生成草稿');await vi.waitFor(()=>expect(draft.value).toBe('--draft one--'));
 draft.value='my edited draft';prompt.value='second prompt';click('重新生成');expect(generate).toHaveBeenCalledOnce();
 const replace=document.querySelector<HTMLInputElement>('input[type=checkbox]')!;expect(replace.closest('label')!.hidden).toBe(false);replace.checked=true;
 click('重新生成');await vi.waitFor(()=>expect(document.querySelector('.mdx-study-create .mdx-study__status')!.textContent).toContain('NETWORK_FAILED'));
 expect(draft.value).toBe('my edited draft');expect(prompt.value).toBe('second prompt');
 click('重新生成');await vi.waitFor(()=>expect(draft.value).toBe('--draft two--'));
 expect(generate.mock.calls[2][0]).toMatchObject({prompt:'second prompt',source:'pasted input',previousDraft:'my edited draft'});
 expect(generate.mock.calls[0][0].operationId).not.toBe(generate.mock.calls[2][0].operationId);
 click('关闭');await pending;expect(save).not.toHaveBeenCalled();warning.mockRestore();
});
it('reads an existing source without writing it and aborts a pending generation on cancel',async()=>{
 let finish!:(value:string)=>void;const generate=vi.fn(()=>new Promise<string>(resolve=>{finish=resolve;})),save=vi.fn(async()=>{});
 const pending=createStudyDocument(document.body,host({documents: {save: save}, generation: {generate: generate}}),studyText('zh-CN'),new AbortController().signal);
 click('选择已有文档');await vi.waitFor(()=>expect(document.querySelector('select')!.hidden).toBe(false));
 const select=document.querySelector('select')!;select.value='/source.md';select.dispatchEvent(new Event('change'));
 await vi.waitFor(()=>expect(document.querySelectorAll<HTMLTextAreaElement>('textarea')[1].value).toBe('original source'));
 document.querySelectorAll<HTMLTextAreaElement>('textarea')[0].value='generate';click('生成草稿');
 const signal=generate.mock.calls[0][0]?.signal;
 click('关闭');await pending;expect(signal.aborted).toBe(true);finish('--late draft--');await Promise.resolve();
 expect(save).not.toHaveBeenCalled();expect(document.querySelector('dialog')).toBeNull();
});
it('keeps the stable save operation identity after a failed save',async()=>{
 const save=vi.fn().mockRejectedValueOnce(Object.assign(new Error('disk full'),{code:'ENOSPC'})).mockResolvedValueOnce(undefined);
 vi.spyOn(console,'warn').mockImplementation(()=>{});
 const pending=createStudyDocument(document.body,host({documents: {save: save}}),studyText('zh-CN'),new AbortController().signal);
 document.querySelector<HTMLInputElement>('dialog input[required]')!.value='new';
 document.querySelector<HTMLTextAreaElement>('.mdx-study-create__draft textarea')!.value='--answer--';
 const submit=()=>document.querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true}));
 submit();await vi.waitFor(()=>expect(document.querySelector('.mdx-study-create .mdx-study__status')!.textContent).toContain('ENOSPC'));
 submit();await vi.waitFor(()=>expect(document.querySelector('dialog')?.textContent).toContain('已保存：new'));expect(save.mock.calls[0][0].operationId).toBe(save.mock.calls[1][0].operationId);click('关闭');await pending;
});
it('keeps the creation dialog open when the native local-file picker is cancelled',async()=>{
 const save=vi.fn(async()=>{}),pending=createStudyDocument(document.body,host({documents: {save: save}}),studyText('zh-CN'),new AbortController().signal);
 const dialog=document.querySelector('dialog')!,input=dialog.querySelector('input[type=file]')!;
 input.dispatchEvent(new Event('cancel',{bubbles:true}));expect(document.querySelector('dialog')).toBe(dialog);
 dialog.querySelector<HTMLInputElement>('input[required]')!.value='retained';click('关闭');await pending;
 expect(save).not.toHaveBeenCalled();
});
it('loads and explicitly saves prompt preferences, and appends parser examples without creating a note',async()=>{
 const save=vi.fn(async()=>{}),promptSave=vi.fn(async()=>{}),pending=createStudyDocument(document.body,host({documents: {save: save}, prompts: {store: {load:async()=>'saved prompt',save:promptSave}}}),studyText('zh-CN'),new AbortController().signal);
 const prompt=document.querySelector<HTMLTextAreaElement>('[role=tabpanel] textarea')!;
 await vi.waitFor(()=>expect(prompt.value).toBe('saved prompt'));
 click('把语法规则加入提示词');expect(prompt.value).toContain('¶');expect(prompt.value).toContain('^^audio:word^^');
 const before=prompt.value;click('把语法规则加入提示词');expect(prompt.value).toBe(before);
 click('保存');await vi.waitFor(()=>expect(promptSave).toHaveBeenCalledWith(before));
 click('关闭');await pending;expect(save).not.toHaveBeenCalled();
});
it('does not replace a prompt edited while preference loading is in flight',async()=>{
 let resolve!:(value:string)=>void;
 const pending=createStudyDocument(document.body,host({documents: {save: async()=>{}}, prompts: {store: {load:()=>new Promise<string>(done=>{resolve=done;}),save:async()=>{}}}}),studyText('zh-CN'),new AbortController().signal);
 const prompt=document.querySelector<HTMLTextAreaElement>('[role=tabpanel] textarea')!;prompt.value='my current prompt';resolve('previous prompt');await Promise.resolve();
 expect(prompt.value).toBe('my current prompt');click('关闭');await pending;
});
it('previews clozes in place, preserves edits and stays open after saving',async()=>{
 const save=vi.fn(async()=>{}),generate=vi.fn(async()=> 'A --[answer] **answer**¶line two--.');
 const pending=createStudyDocument(document.body,host({documents: {save: save}, generation: {generate: generate, targets: {list:async()=>[{id:'chosen',label:'Chosen',model:'m',models:[{id:'m',label:'Model'}]}]}}}),studyText('zh-CN'),new AbortController().signal);
 const prompt=document.querySelector<HTMLTextAreaElement>('textarea')!;prompt.value='convert';document.querySelector<HTMLTextAreaElement>('[aria-label="待处理内容"]')!.value='Source';
 await vi.waitFor(()=>expect(document.querySelector('.mdx-study-create__models select')?.textContent).toContain('Chosen'));
 click('生成草稿');await vi.waitFor(()=>expect(document.querySelector<HTMLTextAreaElement>('.mdx-study-create__draft textarea')!.value).toContain('answer'));
 expect(generate.mock.calls[0][0]).toMatchObject({targetId:'chosen',modelId:'m'});
 click('预览');await vi.waitFor(()=>expect(document.querySelector('.mdx-study-create__preview .mdx-cloze')).not.toBeNull());
 expect(save).not.toHaveBeenCalled();click('编辑');
 const draft=document.querySelector<HTMLTextAreaElement>('.mdx-study-create__draft textarea')!;expect(draft.parentElement!.hidden).toBe(false);draft.value='Edited --answer--';
 document.querySelector<HTMLInputElement>('input[required]')!.value='Final';
 draft.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector<HTMLButtonElement>('[aria-label="保存笔记"]')!.click();await vi.waitFor(()=>expect(document.querySelector('dialog')?.textContent).toContain('已保存：Final'));
 expect(save).toHaveBeenCalledOnce();expect(save.mock.calls[0][0]).toMatchObject({content:'Edited --answer--'});expect(document.querySelector('dialog')).not.toBeNull();click('关闭');await pending;
});
it('clears a draft without saving while retaining instructions and model choices',async()=>{
 const save=vi.fn(async()=>{}),generate=vi.fn(async()=> '--draft--');
 const pending=createStudyDocument(document.body,host({documents: {save: save}, generation: {generate: generate, targets: {list:async()=>[{id:'connection',label:'Connection',models:[{id:'model',label:'Model'}]}]}}}),studyText('zh-CN'),new AbortController().signal);
 const prompt=document.querySelector<HTMLTextAreaElement>('textarea')!,source=document.querySelector<HTMLTextAreaElement>('[aria-label="待处理内容"]')!,name=document.querySelector<HTMLInputElement>('input[required]')!;
 prompt.value='My instructions';source.value='Document';name.value='Old';
 await vi.waitFor(()=>expect(document.querySelector('.mdx-study-create__models select')!.textContent).toContain('Connection'));
 click('生成草稿');await vi.waitFor(()=>expect(document.querySelector<HTMLTextAreaElement>('.mdx-study-create__draft textarea')!.value).toBe('--draft--'));
 click('清空并新建');expect(name.value).toBe('');expect(source.value).toBe('');expect(prompt.value).toBe('My instructions');
 expect(document.querySelector<HTMLTextAreaElement>('.mdx-study-create__draft textarea')!.value).toBe('');expect(save).not.toHaveBeenCalled();
 expect([...document.querySelectorAll<HTMLSelectElement>('.mdx-study-create__models select')].map(select=>select.value)).toEqual(['connection','model']);
 expect(document.querySelector('dialog')).not.toBeNull();click('关闭');await pending;
});
it('shows host execution links, reuses draft identity across runs and resets it for a new document',async()=>{
 const generate=vi.fn(async request=>{request.onExecution({label:'View execution',url:'#/execution/one'});return '--answer--';});
 const pending=createStudyDocument(document.body,host({documents: {save: async()=>{}}, generation: {generate: generate}}),studyText('zh-CN'),new AbortController().signal);
 document.querySelector<HTMLTextAreaElement>('textarea')!.value='Convert';document.querySelector<HTMLTextAreaElement>('[aria-label="待处理内容"]')!.value='Source';click('生成草稿');
 await vi.waitFor(()=>expect(document.querySelector('a[target="_blank"]')?.textContent).toBe('View execution'));
 await vi.waitFor(()=>expect(document.querySelector<HTMLTextAreaElement>('.mdx-study-create__draft textarea')!.value).toBe('--answer--'));
 await vi.waitFor(()=>expect([...document.querySelectorAll('button')].find(button=>button.textContent==='重新生成')?.disabled).toBe(false)); click('重新生成');await vi.waitFor(()=>expect(generate).toHaveBeenCalledTimes(2));
 expect(generate.mock.calls[0][0].draftId).toBe(generate.mock.calls[1][0].draftId);
 await vi.waitFor(()=>expect([...document.querySelectorAll('button')].find(button=>button.textContent==='清空并新建')!.disabled).toBe(false));
 click('清空并新建');expect(document.querySelector('a[target="_blank"]')).toBeNull();document.querySelector<HTMLTextAreaElement>('[aria-label="待处理内容"]')!.value='Another source';click('生成草稿');
 await vi.waitFor(()=>expect(generate).toHaveBeenCalledTimes(3));expect(generate.mock.calls[2][0].draftId).not.toBe(generate.mock.calls[0][0].draftId);
 click('关闭');await pending;
});
it('disables generation and saving until their current prerequisites are satisfied',async()=>{
 const generate=vi.fn(async()=> '--answer--'),save=vi.fn(async()=>{});
 const pending=createStudyDocument(document.body,host({documents: {save: save}, generation: {generate: generate, targets: {list:async()=>[{id:'model',label:'Model'}]}}}),studyText('zh-CN'),new AbortController().signal);
 const run=[...document.querySelectorAll('button')].find(button=>button.textContent==='生成草稿')!,submit=document.querySelector<HTMLButtonElement>('[aria-label="保存笔记"]')!;
 expect(run.disabled).toBe(true);expect(submit.disabled).toBe(true);
 const prompt=document.querySelector<HTMLTextAreaElement>('textarea')!,source=document.querySelector<HTMLTextAreaElement>('[aria-label="待处理内容"]')!,name=document.querySelector<HTMLInputElement>('input[required]')!,draft=document.querySelector<HTMLTextAreaElement>('.mdx-study-create__draft textarea')!;
 prompt.value='Instructions';source.value='Material';source.dispatchEvent(new Event('input',{bubbles:true}));
 await vi.waitFor(()=>expect(run.disabled).toBe(false));
 source.value=' ';source.dispatchEvent(new Event('input',{bubbles:true}));expect(run.disabled).toBe(true);
 name.value='Bad/name';draft.value='--answer--';draft.dispatchEvent(new Event('input',{bubbles:true}));expect(submit.disabled).toBe(true);
 name.value='Ready';name.dispatchEvent(new Event('input',{bubbles:true}));expect(submit.disabled).toBe(false);
 draft.value='';draft.dispatchEvent(new Event('input',{bubbles:true}));expect(submit.disabled).toBe(true);
 click('关闭');await pending;
});
it('searches host sources with @ and multiple terms, then imports the selected document',async()=>{
 const search=vi.fn(async()=>[{id:'opaque',label:'Project · /biology/lever.md'}]),read=vi.fn(async()=> 'Imported material');
 const pending=createStudyDocument(document.body,host({documents: {save: async()=>{}}, generation: {generate: async()=>''}, sources:{search,read}}),studyText('zh-CN'),new AbortController().signal);
 click('选择已有文档');await vi.waitFor(()=>expect(search).toHaveBeenCalledOnce());
 const query=document.querySelector<HTMLInputElement>('.mdx-study-source-search input')!;query.value='@biology lever';query.dispatchEvent(new Event('input',{bubbles:true}));
 await vi.waitFor(()=>expect(search).toHaveBeenLastCalledWith('biology lever',expect.any(AbortSignal)));
 await vi.waitFor(()=>expect(document.querySelector('.mdx-study-source-search__results button')).not.toBeNull());
 (document.querySelector('.mdx-study-source-search__results button') as HTMLButtonElement).click();
 await vi.waitFor(()=>expect(document.querySelector<HTMLTextAreaElement>('[aria-label="待处理内容"]')!.value).toBe('Imported material'));
 expect(read).toHaveBeenCalledWith('opaque',expect.any(AbortSignal));click('关闭');await pending;
});
it('uses Enter to select a matching location before searching its files',async()=>{
 const search=vi.fn(async(_query:string,_signal:AbortSignal,parent?:string)=>parent ? [{id:'file',label:'个人 · /lesson.md',kind:'document' as const}] : [{id:'personal',label:'个人',kind:'directory' as const}]);
 const read=vi.fn(async()=> 'Lesson body');
 const pending=createStudyDocument(document.body,host({documents: {save: async()=>{}}, generation: {generate: async()=>''}, sources:{search,read}}),studyText('zh-CN'),new AbortController().signal);
 click('选择已有文档');await vi.waitFor(()=>expect(document.querySelector('.mdx-study-source-search__results button')).not.toBeNull());
 const query=document.querySelector<HTMLInputElement>('.mdx-study-source-search input')!;query.value='个人';query.dispatchEvent(new Event('input',{bubbles:true}));
 query.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
 await vi.waitFor(()=>expect(search).toHaveBeenCalledWith('',expect.any(AbortSignal),'personal'));
 expect(read).not.toHaveBeenCalled();
 await vi.waitFor(()=>expect(document.querySelector('.mdx-study-source-search__results button')!.textContent).toContain('lesson.md'));
 query.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
 await vi.waitFor(()=>expect(read).toHaveBeenCalledWith('file',expect.any(AbortSignal)));click('关闭');await pending;
});
