// @vitest-environment jsdom
import {afterEach, expect, it, vi} from 'vitest';
import {ContentView} from '../src/content/view';
import {ContentListView} from '../src/content/list';
import {ContentReader} from '../src/content/reader';
import {ContentSelectionAction, readContentSelection} from '../src/content/selection';
const labels = {expand: 'Expand', collapse: 'Collapse', details: 'Time details'};
afterEach(() => {document.body.replaceChildren(); vi.restoreAllMocks();});
it('preserves body nodes and fold state when adding and prepending independent content', () => {
    const list = new ContentListView(), first = new ContentView({labels, title: 'First', preview: 'Preview'}), second = new ContentView({labels});
    first.body.textContent = 'First body'; document.body.append(list.element);
    list.sync([{id: 'a', view: first}]); first.toggle.click(); const body = first.body;
    list.sync([{id: 'b', view: second}, {id: 'a', view: first}]);
    first.update({title: 'Renamed'}); expect(first.preview.textContent).toBe('Preview');
    expect(first.body).toBe(body); expect(first.getExpanded()).toBe(false); expect(first.preview.hidden).toBe(false);
    expect([...list.element.children]).toEqual([second.element, first.element]);
    list.setExpanded(true); expect(first.body.hidden).toBe(false); expect(second.getExpanded()).toBe(true);
    expect(() => list.sync([{id: 'a', view: first}, {id: 'a', view: second}])).toThrow('CONTENT_DUPLICATE_ID');
    expect(list.element.childElementCount).toBe(2); first.destroy(); second.destroy(); list.destroy();
});
it('renders literal mail text without creating executable HTML or Markdown plugins', async () => {
    const container = document.createElement('div'), reader = new ContentReader(container, {format: 'text'});
    await reader.setText('<script>evil()</script>\n**plain**');
    expect(container.querySelector('script')).toBeNull(); expect(container.textContent).toBe(reader.getText());
    await reader.destroy(); await reader.setText('late'); expect(container.textContent).toContain('plain');
});
it('keeps full date information available by click and rejects invalid timestamps', () => {
    const view = new ContentView({labels}); view.setTimes({label: 'Completed', value: 1700000000000}, [{label: 'Started', value: 1699999990000}]);
    view.timeSummary.click(); expect(view.timing.open).toBe(true); expect(view.timeDetails.textContent).toContain('Started');
    expect(view.time.dateTime).toBe(new Date(1700000000000).toISOString());
    view.setTimes({label: 'Completed', value: NaN}); expect(view.timing.hidden).toBe(true); view.destroy();
});
it('freezes cross-item selections, excludes headers, and invokes AI only on explicit click', async () => {
    const list = new ContentListView(), a = new ContentView({labels, title: 'Private header'}), b = new ContentView({labels});
    a.body.textContent = 'First body'; b.body.textContent = 'Second body'; list.sync([{id: 'a', view: a}, {id: 'b', view: b}]); document.body.append(list.element);
    const range = document.createRange(); range.setStart(a.body.firstChild!, 6); range.setEnd(b.body.firstChild!, 6);
    const selection = readContentSelection(list, range)!;
    expect(selection).toEqual({text: 'body\n\nSecond', items: [{id: 'a', text: 'body'}, {id: 'b', text: 'Second'}]});
    expect(Object.isFrozen(selection.items)).toBe(true);
    Object.defineProperty(range, 'getBoundingClientRect', {value: () => ({bottom: 10, right: 10})});
    const selected = document.getSelection()!; selected.removeAllRanges(); selected.addRange(range);
    const run = vi.fn(async () => {}), action = new ContentSelectionAction(list, {label: 'AI', run}); action.refresh();
    expect(action.button.hidden).toBe(false); expect(run).not.toHaveBeenCalled(); action.button.click();
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce()); expect(run.mock.calls[0][0]).toEqual(selection);
    action.destroy(); expect(document.querySelector('.mdx-content-selection')).toBeNull(); a.destroy(); b.destroy();
});

it('keeps a failed AI operation tied to the same selection across pointer refresh and aborts observation when hidden', async () => {
    const list = new ContentListView(), view = new ContentView({title: 'Item'}); view.body.textContent = 'Visible';
    const hidden = document.createElement('span'); hidden.hidden = true; hidden.textContent = 'Hidden'; view.body.append(hidden);
    list.sync([{id: 'item', view}]); document.body.append(list.element);
    const range = document.createRange(); range.selectNodeContents(view.body);
    Object.defineProperty(range, 'getBoundingClientRect', {value: () => ({bottom: 10, right: 10})});
    document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range);
    expect(readContentSelection(list, range)!.text).toBe('Visible');
    const calls: Array<{selection: unknown; signal: AbortSignal}> = [], onError = vi.fn();
    let finish!: () => void;
    const run = vi.fn(async (selection, signal: AbortSignal) => {calls.push({selection, signal}); if (calls.length === 1) throw new Error('RETRY'); await new Promise<void>(resolve => {finish = resolve;});});
    list.configureSelection({run, onError}); document.dispatchEvent(new Event('selectionchange'));
    const button = document.querySelector<HTMLButtonElement>('.mdx-content-selection')!; button.click();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    document.dispatchEvent(new Event('pointerup')); button.click();
    expect(calls[1].selection).toBe(calls[0].selection);
    list.setActive(false); expect(calls[1].signal.aborted).toBe(true); expect(button.hidden).toBe(true);
    finish(); list.destroy(); view.destroy(); expect(document.querySelector('.mdx-content-selection')).toBeNull();
});

it('retains Markdown rendering and host plugins in the shared reader', async () => {
    const {FoldablePlugin} = await import('../src/plugins/syntax-extensions/foldable.plugin');
    const body = document.createElement('div'), reader = new ContentReader(body, {format: 'markdown', plugins: [new FoldablePlugin()]});
    await reader.setText('**Readable Markdown**\n\n::> Notes\n    **Plugin content**\n');
    expect(body.querySelector('strong')!.textContent).toBe('Readable Markdown'); expect(body.querySelector('details')).not.toBeNull();
    await reader.setText('**Streaming Markdown**', true); expect(body.textContent).toContain('Streaming Markdown');
    await reader.destroy();
});
