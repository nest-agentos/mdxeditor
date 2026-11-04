// @vitest-environment jsdom
import {expect, it, vi} from 'vitest';
import {StudyPrompts} from '../src/study/prompts';
import {studyText} from '../src/study/locale';
it('uses one editable name and one save action to update or create prompts', async () => {
 const prompt=document.createElement('textarea'),saveList=vi.fn(async()=>{});
 const ui=new StudyPrompts({presets: [{id:'a',name:'A',content:'one'},{id:'b',name:'B',content:'two'}], store: {load:async()=>undefined,save:async()=>{},list:async()=>undefined,saveList}},prompt,studyText('zh-CN'),async action=>action());
 await ui.load(new AbortController().signal);
 const name=ui.element.querySelector('input')!,button=ui.element.querySelector<HTMLButtonElement>('.mdx-study-prompts > button')!;
 expect(ui.element.querySelectorAll('.mdx-study-prompts > button')).toHaveLength(1);
 prompt.value='edited';prompt.dispatchEvent(new Event('input'));
 name.value='B';name.dispatchEvent(new Event('change'));expect(prompt.value).toBe('two');
 name.value='A';name.dispatchEvent(new Event('change'));expect(prompt.value).toBe('edited');
 button.click();await vi.waitFor(()=>expect(saveList).toHaveBeenCalledTimes(1));
 expect(saveList.mock.calls[0]).toEqual([[{id:'b',name:'B',content:'two'},{id:'a',name:'A',content:'edited'}]]);
 name.value='copy';button.click();await vi.waitFor(()=>expect(saveList).toHaveBeenCalledTimes(2));
 expect(ui.element.querySelectorAll('[role=option]')).toHaveLength(3);expect(name.value).toBe('copy');expect(prompt.value).toBe('edited');
});
it('keeps current edits when stored prompts finish loading late', async()=>{
 let resolve!:(value:undefined)=>void;const prompt=document.createElement('textarea');
 const ui=new StudyPrompts({presets: [{id:'a',name:'A',content:'one'}], store: {load:async()=> 'old',save:async()=>{},list:()=>new Promise(done=>{resolve=done;}),saveList:async()=>{}}},prompt,studyText('zh-CN'),async action=>action());
 const pending=ui.load(new AbortController().signal);prompt.value='mine';prompt.dispatchEvent(new Event('input'));resolve(undefined);await pending;
 expect(prompt.value).toBe('mine');expect(ui.element.querySelectorAll('[role=option]')).toHaveLength(2);
});
it('does not overwrite a prompt collection that failed to load',async()=>{
 const saveList=vi.fn(async()=>{}),errors:unknown[]=[];
 const ui=new StudyPrompts({presets: [{id:'a',name:'A',content:'one'}], store: {load:async()=>undefined,save:async()=>{},list:async()=>{throw new Error('Invalid data');},saveList}},document.createElement('textarea'),studyText('zh-CN'),async action=>{try{await action();}catch(error){errors.push(error);}});
 await expect(ui.load(new AbortController().signal)).rejects.toThrow('Invalid data');
 ui.element.querySelector<HTMLButtonElement>('.mdx-study-prompts > button')!.click();await vi.waitFor(()=>expect(errors).toHaveLength(1));
 expect(errors[0]).toMatchObject({code:'PROMPTS_NOT_LOADED'});expect(saveList).not.toHaveBeenCalled();
});
it('expands all restored templates even when the input contains the first name',async()=>{
 const prompt=document.createElement('textarea'),templates=[{id:'words',name:'背单词',content:'Words'},{id:'concepts',name:'背概念',content:'Concepts'},{id:'classical',name:'背古文',content:'Classical'}];
 const ui=new StudyPrompts({store: {load:async()=>undefined,save:async()=>{},list:async()=>templates,saveList:async()=>{}}},prompt,studyText('zh-CN'),async action=>action());
 await ui.load(new AbortController().signal);
 const input=ui.element.querySelector('input')!,toggle=ui.element.querySelector<HTMLButtonElement>('[aria-label="选择提示词"]')!;
 expect(input.value).toBe('背单词');toggle.click();
 expect(ui.element.querySelector('ul')!.hidden).toBe(false);
 expect([...ui.element.querySelectorAll('[role=option]')].map(item=>item.textContent)).toEqual(['背单词','背概念','背古文']);
 (ui.element.querySelectorAll('[role=option]')[1] as HTMLElement).click();expect(prompt.value).toBe('Concepts');expect(input.value).toBe('背概念');
 toggle.click();(ui.element.querySelectorAll('[role=option]')[2] as HTMLElement).click();expect(prompt.value).toBe('Classical');
 input.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));
 input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));expect(input.value).toBe('背单词');
 toggle.click();input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));expect(input.getAttribute('aria-expanded')).toBe('false');
});
