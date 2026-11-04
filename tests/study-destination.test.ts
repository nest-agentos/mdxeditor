// @vitest-environment jsdom
import {expect,it,vi} from 'vitest';
import {StudyDestination} from '../src/study/destination';
import {studyText} from '../src/study/locale';
import type {StudyHost} from '../src/study/contracts';
const folder={id:'opaque-parent',title:'英语',kind:'directory' as const},child={id:'opaque-child',title:'阅读',kind:'directory' as const};
async function setup(parent?:typeof folder){
 const controller=new AbortController(),read=vi.fn(),list=vi.fn(async(id?:string)=>id===folder.id?[child]:id===child.id?[]:[folder]);
 const picker=new StudyDestination({list,read} as unknown as StudyHost,studyText('zh-CN'),controller.signal,parent);
 document.body.append(picker.element);const input=picker.element.querySelector<HTMLInputElement>('input')!;input.focus();
 await vi.waitFor(()=>expect(picker.element.querySelectorAll('[role=option]')).toHaveLength(3));
 return{picker,input,read,list,close(){controller.abort();picker.element.remove();}};
}
it('filters hierarchical directory labels and submits opaque IDs without reading content',async()=>{
 const f=await setup();
 try{
  expect(f.picker.value()).toBeUndefined();f.input.value='英语/阅读';f.input.dispatchEvent(new Event('input'));
  expect(f.picker.element.querySelectorAll('[role=option]')).toHaveLength(1);
  f.input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
  expect(f.picker.value()).toEqual(child);expect(f.input.value).toBe('英语 / 阅读');expect(f.read).not.toHaveBeenCalled();
  expect(f.list).toHaveBeenCalledTimes(3);
 }finally{f.close();}
});
it('preserves contextual defaults, supports keyboard navigation and rejects unresolved typed folders',async()=>{
 const f=await setup(folder);
 try{
  f.input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));expect(f.picker.value()).toEqual(folder);
  f.input.value='unknown';f.input.dispatchEvent(new Event('input'));expect(()=>f.picker.value()).toThrow('请从列表选择');
  f.input.value='阅读';f.input.dispatchEvent(new Event('input'));f.input.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));
  expect(f.input.getAttribute('aria-activedescendant')).toBeTruthy();
  f.input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));expect(f.picker.value()).toEqual(child);
 }finally{f.close();}
});
it('lists save destinations from the creation capability even when no learning sources are tracked',async()=>{
 const controller=new AbortController(),list=vi.fn(async()=>[]),read=vi.fn();
 const directories={list:vi.fn(async(id?:string)=>id===folder.id?[child]:id===child.id?[]:[folder])};
 const picker=new StudyDestination({list,read,creation:{documents: {directories: directories}}} as unknown as StudyHost,studyText('zh-CN'),controller.signal);
 document.body.append(picker.element);const input=picker.element.querySelector<HTMLInputElement>('input')!;
 try{
  input.focus();await vi.waitFor(()=>expect(picker.element.querySelectorAll('[role=option]')).toHaveLength(3));
  input.value='阅读';input.dispatchEvent(new Event('input'));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
  expect(picker.value()).toEqual(child);expect(list).not.toHaveBeenCalled();expect(read).not.toHaveBeenCalled();
 }finally{controller.abort();picker.element.remove();}
});
it('shows root directories before a slow nested enumeration completes',async()=>{
 const controller=new AbortController();let finish!:(value:typeof child[])=>void;
 const directories={list:vi.fn(async(id?:string)=>id===folder.id?new Promise<typeof child[]>(resolve=>{finish=resolve;}):[folder])};
 const picker=new StudyDestination({list:vi.fn(async()=>[]),creation:{documents: {directories: directories}}} as unknown as StudyHost,studyText('zh-CN'),controller.signal);
 document.body.append(picker.element);
 try{
  picker.element.querySelector<HTMLInputElement>('input')!.focus();
  await vi.waitFor(()=>expect(picker.element.querySelectorAll('[role=option]')).toHaveLength(2));
  expect([...picker.element.querySelectorAll('[role=option]')].some(option=>option.textContent==='英语')).toBe(true);
  finish([]);
 }finally{controller.abort();picker.element.remove();}
});
