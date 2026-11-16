// @vitest-environment jsdom
import {afterEach, expect, it, vi} from 'vitest';
import {documentProfile} from '../src/editor/document-policy';
import {prepareHtmlDocument} from '../src/editor/html-policy';
import {htmlPreviewDocument} from '../src/editor/html-document';
import {HtmlDom} from '../src/editor/html-dom';
import {HtmlRuntime} from '../src/editor/html-runtime';

const runtimes: HtmlRuntime[] = [];
afterEach(() => {for (const runtime of runtimes.splice(0)) runtime.destroy(); vi.useRealTimers(); document.body.replaceChildren();});

it.each(['one.HTML', 'two.hTm', 'three.html'])('opens %s without Markdown parsing', documentPath => {
    expect(documentProfile({documentPath}, '')).toMatchObject({format: 'html', initialMode: 'render', enableMarkdown: false});
    expect(documentProfile({documentPath, initialMode: 'edit'}, '')).toMatchObject({initialMode: 'edit'});
});
it('filters markup before browser parsing and extracts scripts and handlers without enabling native execution', () => {
    const source = '<!doctype html><body onload="ready()"><button onclick="count++">Run</button><script>test()</script><link rel="dns-prefetch" href="//leak.test"><iframe srcdoc="attack"></iframe><input type="file"><meta http-equiv="refresh" content="0;url=https://leak.test">';
    const result = prepareHtmlDocument(source);
    expect(result.scripts).toEqual(['test()']); expect(result.handlers.map(value => value.event)).toEqual(['load', 'click']);
    expect(result.html).not.toMatch(/<script|<link|<iframe|<meta|type="file"|onclick|onload/);
    const outer = new DOMParser().parseFromString(htmlPreviewDocument(source), 'text/html');
    expect(outer.querySelector('iframe')!.getAttribute('sandbox')).toBe('allow-same-origin');
    expect(outer.querySelector('meta[http-equiv]')!.getAttribute('content')).toContain("script-src 'none'");
});
it('uses one constraint for source and dynamic attributes, and never accepts foreign nodes', () => {
    document.body.innerHTML = '<input id="field"><p></p>';
    const issue = vi.fn(), dom = new HtmlDom(document, issue);
    const id = dom.id(document.querySelector('input'))!;
    for (const type of ['file', 'image', 'FiLe']) expect(JSON.parse(dom.request(JSON.stringify(['call', id, 'setAttribute', ['TYPE', type]]))).error).toBe('HTML_ATTRIBUTE_BLOCKED');
    expect(document.querySelector('input')!.type).toBe('text');
    expect(() => dom.id(document.implementation.createHTMLDocument().body)).toThrow('HTML_NODE_OUTSIDE_DOCUMENT');
    expect(JSON.parse(dom.request(JSON.stringify(['get', 0, 'defaultView', []]))).error).toBe('HTML_DOM_API_UNSUPPORTED');
    dom.destroy();
});
async function fixture(source: string) {
    const prepared = prepareHtmlDocument(source), doc = new DOMParser().parseFromString(prepared.html, 'text/html'), issue = vi.fn();
    const runtime = new HtmlRuntime(doc, issue); runtimes.push(runtime); await runtime.start(prepared);
    return {runtime, doc, issue};
}
it('runs body.onload, inline events and DOMContentLoaded through isolated node wrappers', async () => {
    const {doc, issue} = await fixture('<body onload="document.body.dataset.loaded=\'yes\'"><button id="button" onclick="this.textContent=\'clicked\'">Try</button><script>document.addEventListener("DOMContentLoaded",()=>document.getElementById("button").dataset.ready="yes")</script>');
    expect(doc.body.dataset.loaded).toBe('yes');
    const button = doc.querySelector('button')!; expect(button.getAttribute('data-ready')).toBe('yes');
    button.dispatchEvent(new MouseEvent('click', {bubbles: true})); expect(button.textContent).toBe('clicked');
    expect(issue).not.toHaveBeenCalled();
});
it('returns only event-control bits and respects preventDefault and propagation within the preview', async () => {
    const {doc} = await fixture('<body onclick="document.body.dataset.bubbled=1"><button onclick="event.preventDefault();event.stopPropagation();this.textContent=1">Event</button>');
    const event = new MouseEvent('click', {bubbles: true, cancelable: true});
    doc.querySelector('button')!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true); expect(doc.body.dataset.bubbled).toBeUndefined();
    expect(doc.querySelector('button')!.textContent).toBe('1');
});
it('bounds CPU, memory and Promise jobs and releases each exhausted realm', async () => {
    for (const [source, code] of [['while(true){}', 'HTML_SCRIPT_TIME_LIMIT'], ['new Uint8Array(64*1024*1024)', 'HTML_SCRIPT_MEMORY_LIMIT'],
        ['function loop(){Promise.resolve().then(loop)}loop()', 'HTML_PROMISE_JOB_LIMIT']]) {
        const {issue, runtime} = await fixture('<script>' + source + '</script>');
        expect(issue).toHaveBeenCalledWith(code); runtime.destroy();
    }
});
it('supports Promise/timer callbacks, clearing an interval from its callback and teardown', async () => {
    vi.useFakeTimers();
    const {runtime, doc} = await fixture('<body><script>Promise.resolve().then(()=>document.body.dataset.promise="yes");new Promise(resolve=>setTimeout(resolve,25)).then(()=>document.body.dataset.delayed="yes");new Promise(resolve=>setTimeout(resolve,1000)).then(()=>document.body.dataset.latePromise="bad");let count=0;const timer=setInterval(()=>{document.body.dataset.count=++count;clearInterval(timer)},16);setTimeout(()=>document.body.dataset.late="bad",1000)</script>');
    expect(doc.body.dataset.promise).toBe('yes');
    await vi.advanceTimersByTimeAsync(80); expect(doc.body.dataset.count).toBe('1'); expect(doc.body.dataset.delayed).toBe('yes');
    runtime.destroy(); await vi.advanceTimersByTimeAsync(2000); expect(doc.body.dataset.late).toBeUndefined(); expect(doc.body.dataset.latePromise).toBeUndefined(); expect(vi.getTimerCount()).toBe(0);
});
