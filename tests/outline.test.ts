// @vitest-environment jsdom
import {afterEach, expect, it, vi} from 'vitest';
import {createMDxEditor} from '../src/factory';
import {NavigationManager} from '../src/editor/navigation';
import {MarkedAdapter} from '../src/renderer/marked-adapter';
import type {CodeMirrorAdapter} from '../src/editor/codemirror-adapter';
const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {for (const close of cleanup.splice(0)) await close(); document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks();});
it('keeps copy, contents, More order and saves through the retained More action in both modes', async () => {
    vi.stubGlobal('matchMedia', () => ({matches: false, addEventListener() {}, removeEventListener() {}}));
    const mount = document.createElement('div'); document.body.append(mount); const save = vi.fn(async () => {});
    const editor = await createMDxEditor(mount, {initialMode: 'render', initialContent: '# One\n\n## Two\n\n### Three\n\n#### Excluded', onSave: save,
        plugins: ['editor:core', ['core:titlebar', {enableToggleEditMode: true, saveCallback: () => editor.save()}]]});
    cleanup.push(() => editor.destroy());
    const actions = [...mount.querySelectorAll<HTMLElement>('.ui-content-titlebar__actions [data-button-id]')].filter(node => !node.closest('.mdx-editor-titlebar__menu'));
    expect(actions.map(node => node.dataset.buttonId)).toEqual(['copy-content', 'outline']);
    const outline = mount.querySelector<HTMLButtonElement>('[data-button-id="outline"]')!;
    outline.click(); await vi.waitFor(() => expect(mount.querySelectorAll('[data-outline-id]')).toHaveLength(3));
    const navigate = vi.spyOn(editor, 'navigateTo').mockResolvedValue();
    mount.querySelector<HTMLButtonElement>('[data-outline-id="heading-two"]')!.click(); expect(navigate).toHaveBeenCalledWith({elementId: 'heading-two'});
    expect(mount.querySelector('[data-outline-id="heading-three"]')!.closest('[hidden]')).not.toBeNull();
    outline.click(); await editor.switchToMode('edit'); editor.setText('# Changed'); editor.setDirty(true);
    outline.click(); await vi.waitFor(() => expect(mount.querySelector('[data-outline-id="heading-changed"]')).not.toBeNull());
    const saveAction = mount.querySelector<HTMLButtonElement>('[data-button-id="save-action"]')!;
    expect(saveAction.closest('.mdx-editor-titlebar__menu')).not.toBeNull(); saveAction.click(); await vi.waitFor(() => expect(save).toHaveBeenCalledWith('# Changed'));
});
it('navigates source headings after code fences using exact offsets and rejects deleted targets', async () => {
    const adapter = {scrollTo: vi.fn(), addHighlight: vi.fn(), clearHighlight: vi.fn(), focus: vi.fn()};
    const navigation = new NavigationManager(adapter as unknown as CodeMirrorAdapter); cleanup.push(() => navigation.destroy());
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {callback(0); return 1;});
    const content = '```md\n# Hidden\n```\n\n# Same\n\n## Same\n\n### Last';
    await navigation.navigateInEditor('heading-same-1', content, 1, false);
    expect(adapter.scrollTo).toHaveBeenCalledWith(expect.objectContaining({pos: content.indexOf('## Same')}));
    await expect(navigation.navigateInEditor('heading-same-2', content, 1, false)).rejects.toThrow('OUTLINE_SOURCE_TARGET_MISSING');
});
it('renders distinct duplicate heading targets and reveals only selected disclosure ancestors', async () => {
    const adapter = new MarkedAdapter(), root = document.createElement('div'); document.body.append(root);
    root.innerHTML = await adapter.parse('# Same\n\n## Same\n\n### Same', []);
    expect([...root.querySelectorAll('h1,h2,h3')].map(node => node.id)).toEqual(['heading-same', 'heading-same-1', 'heading-same-2']);
    const details = document.createElement('details'); details.innerHTML = '<summary>Folded</summary><h3 id="hidden">Target</h3>'; root.append(details);
    const target = details.querySelector<HTMLElement>('h3')!; target.scrollIntoView = vi.fn(); vi.stubGlobal('CSS', {escape: (id: string) => id});
    const navigation = new NavigationManager({} as CodeMirrorAdapter); cleanup.push(() => navigation.destroy());
    await navigation.navigateInRenderer(root, 'hidden', false); expect(details.open).toBe(true); expect(document.activeElement).toBe(target);
});
it('matches rendered setext and closing-hash headings, CRLF offsets and unclosed code fences', async () => {
    const source = 'Intro\r\n=====\r\n\r\n```\r\n# Hidden\r\n```\r\n\r\n  ## Repeated ##\r\n\r\n### Last\r\n\r\n~~~\r\n# Also hidden';
    const adapter = {scrollTo: vi.fn(), addHighlight: vi.fn(), clearHighlight: vi.fn(), focus: vi.fn()};
    const navigation = new NavigationManager(adapter as unknown as CodeMirrorAdapter); cleanup.push(() => navigation.destroy());
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {callback(0); return 1;});
    expect(navigation.getHeadings(source, 1).map(item => item.id)).toEqual(['heading-intro', 'heading-repeated', 'heading-last']);
    await navigation.navigateInEditor('heading-last', source, 1, false);
    expect(adapter.scrollTo).toHaveBeenCalledWith(expect.objectContaining({pos: source.indexOf('### Last')}));
});
