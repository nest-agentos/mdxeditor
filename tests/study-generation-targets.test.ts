// @vitest-environment jsdom
import {expect,it,vi} from 'vitest';
import {StudyGenerationTargets} from '../src/study/generation-targets';
import {studyText} from '../src/study/locale';
it('prefers the default, accepts another target, and does not silently replace a deleted selection',async()=>{
 let items=[{id:'a',label:'A',default:true},{id:'b',label:'B'}];
 const list=vi.fn(async()=>items),picker=new StudyGenerationTargets({list},studyText('zh-CN'),new AbortController().signal);
 await vi.waitFor(()=>expect(picker.value()).toBe('a'));const select=picker.element.querySelector('select')!;
 select.value='b';expect(picker.value()).toBe('b');
 picker.element.querySelector('button')!.click();await vi.waitFor(()=>expect(list).toHaveBeenCalledTimes(2));expect(picker.value()).toBe('b');
 items=[items[0]];picker.element.querySelector('button')!.click();await vi.waitFor(()=>expect(list).toHaveBeenCalledTimes(3));
 expect(()=>picker.value()).toThrow();
});
it('blocks unavailable choices and recovers after refreshing configuration',async()=>{
 let items=[{id:'a',label:'A',disabled:true,reason:'TEXT_CREDENTIALS_MISSING'}];
 const picker=new StudyGenerationTargets({list:async()=>items},studyText('zh-CN'),new AbortController().signal);
 await vi.waitFor(()=>expect(picker.element.textContent).toContain('没有可用'));expect(()=>picker.value()).toThrow();
 items=[{id:'a',label:'A',disabled:false,reason:''}];picker.element.querySelector('button')!.click();
 await vi.waitFor(()=>expect(picker.value()).toBe('a'));
});
it('allows models within a connection and remembers the choice when returning to it',async()=>{
 const picker=new StudyGenerationTargets({list:async()=>[{id:'a',label:'A',default:true,model:'m1',models:[{id:'m1',label:'Model 1'},{id:'m2',label:'Model 2'}]},{id:'b',label:'B',models:[{id:'b1',label:'B1'}]}]},studyText('zh-CN'),new AbortController().signal);
 await vi.waitFor(()=>expect(picker.modelId()).toBe('m1'));
 const [connection,model]=picker.element.querySelectorAll('select');model.value='m2';model.dispatchEvent(new Event('change'));expect(picker.modelId()).toBe('m2');
 connection.value='b';connection.dispatchEvent(new Event('change'));expect(picker.modelId()).toBe('b1');
 connection.value='a';connection.dispatchEvent(new Event('change'));expect(picker.modelId()).toBe('m2');
});
