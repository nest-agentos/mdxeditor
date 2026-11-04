// @vitest-environment jsdom
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {createMDxEditor} from '../src/factory';
import {MemoryStore} from '../src/core/store/memory-store';
import type {ScopedPersistenceStore} from '../src/core/types';
import {readDisplayMode, storedDisplayMode, type ClozeDisplayMode} from '../src/plugins/cloze/display-state';
import {nextReview} from '../src/plugins/cloze/memory.plugin';
import {clozeLocatorId} from '../src/renderer/worker-tokenizers';

const NOW = Date.UTC(2026, 0, 10), KEY = 'display:' + clozeLocatorId('alpha', 0);
beforeEach(() => {
    vi.stubGlobal('matchMedia', () => ({matches: false, addEventListener() {}, removeEventListener() {}}));
    Object.defineProperty(Range.prototype, 'getClientRects', {configurable: true, value: () => []});
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {configurable: true, value: () => new DOMRect()});
});
afterEach(() => {vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.replaceChildren();});

async function mountEditor(store: ScopedPersistenceStore) {
    const mount = document.createElement('div'); document.body.append(mount);
    const editor = await createMDxEditor(mount, {initialContent: '--alpha-- and --beta--', initialMode: 'render',
        plugins: ['cloze:cloze'], storeFactory: () => store, defaultPluginOptions: {'cloze:memory': {now: () => NOW}}});
    return {mount, editor, alpha: mount.querySelector<HTMLElement>('.mdx-cloze')!};
}

function selectMode(alpha: HTMLElement, mode: ClozeDisplayMode): void {
    alpha.click();
    alpha.querySelector<HTMLButtonElement>(`[data-display="${mode}"]`)!.click();
}

it('round trips display records independently of the existing grade schema', () => {
    for (const mode of ['open', 'hidden'] as const)
        expect(readDisplayMode(JSON.parse(JSON.stringify(storedDisplayMode(mode))))).toBe(mode);
    expect(storedDisplayMode('normal')).toBeUndefined();
    expect(readDisplayMode(undefined)).toBe('normal');
    expect(readDisplayMode(null)).toBe('normal');
    for (const value of [{v: 2, mode: 'open'}, {v: 1, mode: 'normal'}, {v: 1, mode: 5}, 'open', 5])
        expect(() => readDisplayMode(value)).toThrow('Unsupported cloze display preference');
});

it.each(['open', 'hidden'] as const)('persists %s across destruction and JSON reload without creating review progress', async mode => {
    // Serialize the host values to exercise the same boundary as a persistent host store.
    const data = new Map<string, string>();
    const store: ScopedPersistenceStore = {
        get: async key => data.has(key) ? JSON.parse(data.get(key)!) : undefined,
        set: async (key, value) => {data.set(key, JSON.stringify(value));},
        remove: async key => {data.delete(key);},
    };
    const first = await mountEditor(store);
    try {
        selectMode(first.alpha, mode);
        await vi.waitFor(() => expect(first.alpha.dataset.clozeDisplay).toBe(mode));
        expect(first.alpha.classList.contains('hidden')).toBe(mode === 'hidden');
        expect([...data.keys()]).toEqual([KEY]);
        expect(first.editor.getText()).toBe('--alpha-- and --beta--');
        first.alpha.click();
        expect(first.alpha.classList.contains('hidden')).toBe(mode === 'hidden');
        expect(first.alpha.querySelector(`[data-display="${mode}"]`)?.getAttribute('aria-pressed')).toBe('true');
    } finally {await first.editor.destroy();}
    const second = await mountEditor(store);
    try {
        expect(second.alpha.dataset.clozeDisplay).toBe(mode);
        expect(second.alpha.classList.contains('hidden')).toBe(mode === 'hidden');
        expect(second.mount.querySelectorAll('.mdx-cloze')[1].classList.contains('hidden')).toBe(true);
        selectMode(second.alpha, 'normal');
        await vi.waitFor(() => expect(second.alpha.dataset.clozeDisplay).toBe('normal'));
        expect(second.alpha.classList.contains('hidden')).toBe(true);
        expect(data.size).toBe(0);
        second.alpha.click();
        expect(second.alpha.classList.contains('hidden')).toBe(false);
        expect(second.alpha.querySelectorAll('[data-grade]')).toHaveLength(4);
    } finally {await second.editor.destroy();}
    const third = await mountEditor(store);
    try {expect(third.alpha.dataset.clozeDisplay).toBe('normal');}
    finally {await third.editor.destroy();}
});

it('gives persistent modes priority over bulk toggles, reverse, rerender and reset', async () => {
    const store = new MemoryStore();
    await store.set(KEY, {v: 1, mode: 'open'});
    await store.set('display:' + clozeLocatorId('beta', 0), {v: 1, mode: 'hidden'});
    const {mount, editor} = await mountEditor(store);
    const assertVisibility = () => {
        const cards = mount.querySelectorAll('.mdx-cloze');
        expect(cards[0].classList.contains('hidden')).toBe(false);
        expect(cards[1].classList.contains('hidden')).toBe(true);
    };
    try {
        assertVisibility();
        for (const action of ['toggle-visible', 'toggle-visible', 'reverse']) {
            mount.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!.click();
            assertVisibility();
        }
        await editor.switchToMode('edit');
        editor.setText('--alpha-- and --beta--\n\nupdated');
        await editor.switchToMode('render');
        assertVisibility();
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        await (editor.commands['resetClozeProgress'] as () => Promise<boolean>)();
        assertVisibility();
        expect(await store.get(KEY)).toEqual({v: 1, mode: 'open'});
    } finally {await editor.destroy();}
});

it.each([2, 4])('keeps grade %i scheduling and history independent of fixed visibility', async grade => {
    const store = new MemoryStore(), cardKey = 'card:' + clozeLocatorId('alpha', 0);
    const original = nextReview(undefined, 4, NOW - 1000);
    await store.set(cardKey, {v: 1, ...original});
    await store.set(KEY, {v: 1, mode: 'hidden'});
    const {alpha, editor} = await mountEditor(store);
    try {
        selectMode(alpha, 'open');
        await vi.waitFor(() => expect(alpha.dataset.clozeDisplay).toBe('open'));
        expect(await store.get(cardKey)).toEqual({v: 1, ...original});
        alpha.click();
        alpha.querySelector<HTMLButtonElement>(`[data-grade="${grade}"]`)!.click();
        await vi.waitFor(async () => expect(await store.get(cardKey)).toMatchObject(nextReview(original, grade, NOW)));
        expect(alpha.classList.contains('hidden')).toBe(false);
        expect(await store.get(KEY)).toEqual({v: 1, mode: 'open'});
        selectMode(alpha, 'hidden');
        await vi.waitFor(() => expect(alpha.dataset.clozeDisplay).toBe('hidden'));
        alpha.click();
        alpha.querySelector<HTMLButtonElement>('[data-grade="4"]')!.click();
        await vi.waitFor(async () => expect(await store.get(cardKey)).toMatchObject({reviewCount: 3, lastGrade: 4}));
        expect(alpha.classList.contains('hidden')).toBe(true);
        selectMode(alpha, 'normal');
        await vi.waitFor(() => expect(alpha.dataset.clozeDisplay).toBe('normal'));
        expect(alpha.classList.contains('hidden')).toBe(false);
        const saved = await store.get(cardKey) as {history: {events: Array<{grade: number}>}};
        expect(saved.history.events.map(event => event.grade)).toEqual([grade, 4]);
    } finally {await editor.destroy();}
});

it('retains the previous display preference after a failed save or removal and permits retry', async () => {
    const store = new MemoryStore(); await store.set(KEY, {v: 1, mode: 'hidden'});
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = Object.assign(new Error('secret document contents'), {code: 'EACCES'});
    const {alpha, editor} = await mountEditor(store);
    try {
        const set = vi.spyOn(store, 'set').mockRejectedValueOnce(failure);
        selectMode(alpha, 'open');
        await vi.waitFor(() => expect(errorLog).toHaveBeenCalledOnce());
        expect(alpha.dataset.clozeDisplay).toBe('hidden');
        expect(alpha.classList.contains('hidden')).toBe(true);
        const button = alpha.querySelector<HTMLButtonElement>('[data-display="open"]')!;
        expect(button.disabled).toBe(false); button.click();
        await vi.waitFor(() => expect(alpha.dataset.clozeDisplay).toBe('open'));
        expect(set).toHaveBeenCalledTimes(2);
        vi.spyOn(store, 'remove').mockRejectedValueOnce(failure);
        selectMode(alpha, 'normal');
        await vi.waitFor(() => expect(errorLog).toHaveBeenCalledTimes(2));
        expect(alpha.dataset.clozeDisplay).toBe('open');
        alpha.querySelector<HTMLButtonElement>('[data-display="normal"]')!.click();
        await vi.waitFor(() => expect(alpha.dataset.clozeDisplay).toBe('normal'));
        expect(JSON.stringify(errorLog.mock.calls)).not.toContain('secret document contents');
        expect(errorLog.mock.calls[0][1]).toMatchObject({operation: 'cloze.display', stage: 'persist', code: 'EACCES', result: 'failure'});
    } finally {await editor.destroy();}
});

it('reports invalid records without modifying them or ordinary clozes', async () => {
    const store = new MemoryStore(), invalid = {v: 99, mode: 'hidden'};
    await store.set(KEY, invalid);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {}), writes = vi.spyOn(store, 'set');
    const {alpha, editor} = await mountEditor(store);
    try {
        expect(alpha.dataset.clozeDisplay).toBe('normal');
        expect(errorLog.mock.calls[0][1]).toMatchObject({stage: 'decode', code: 'CLOZE_DISPLAY_INVALID'});
        expect(writes).not.toHaveBeenCalled();
        expect(await store.get(KEY)).toEqual(invalid);
        alpha.click(); expect(alpha.classList.contains('hidden')).toBe(false);
    } finally {await editor.destroy();}
});

it('keeps display actions available during cooling without enabling another grade', async () => {
    const store = new MemoryStore();
    await store.set('card:' + clozeLocatorId('alpha', 0), {v: 1, ...nextReview(undefined, 1, NOW)});
    const {alpha, editor} = await mountEditor(store);
    try {
        expect(alpha.dataset.stateClass).toBe('is-cooling');
        alpha.click(); alpha.click();
        expect(alpha.querySelectorAll('[data-grade]')).toHaveLength(0);
        expect(alpha.querySelectorAll('[data-display]')).toHaveLength(3);
        alpha.querySelector<HTMLButtonElement>('[data-display="hidden"]')!.click();
        await vi.waitFor(() => expect(alpha.dataset.clozeDisplay).toBe('hidden'));
        expect(alpha.classList.contains('hidden')).toBe(true);
        selectMode(alpha, 'normal');
        await vi.waitFor(() => expect(alpha.dataset.clozeDisplay).toBe('normal'));
        expect(alpha.classList.contains('hidden')).toBe(false);
    } finally {await editor.destroy();}
});

it('applies a committed display change to the current DOM after a rerender during saving', async () => {
    const store = new MemoryStore(), set = store.set.bind(store);
    let finish!: () => void;
    const saving = new Promise<void>(resolve => {finish = resolve;});
    vi.spyOn(store, 'set').mockImplementation(async (key, value) => {await saving; await set(key, value);});
    const {alpha, editor, mount} = await mountEditor(store);
    try {
        selectMode(alpha, 'open');
        expect(alpha.dataset.clozeDisplay).toBe('normal');
        await editor.switchToMode('edit');
        editor.setText('--alpha-- and --beta--\n\nnew DOM');
        await editor.switchToMode('render');
        const current = mount.querySelector<HTMLElement>('.mdx-cloze')!;
        expect(current).not.toBe(alpha);
        finish();
        await vi.waitFor(() => expect(current.dataset.clozeDisplay).toBe('open'));
        expect(current.classList.contains('hidden')).toBe(false);
    } finally {finish(); await editor.destroy();}
});

it('isolates failed individual reads, retries on rerender and logs no private error details', async () => {
    const backing = new MemoryStore(), betaKey = 'display:' + clozeLocatorId('beta', 0);
    await backing.set(KEY, {v: 1, mode: 'open'}); await backing.set(betaKey, {v: 1, mode: 'hidden'});
    const get = vi.fn(async (key: string) => backing.get(key));
    get.mockImplementationOnce(async () => {throw Object.assign(new Error('private document path'), {code: 'EIO'});});
    // Initial SRS loading reads _mdx_srs before display preferences.
    const store: ScopedPersistenceStore = {get: key => key === '_mdx_srs' ? backing.get(key) : get(key),
        set: (key, value) => backing.set(key, value), remove: key => backing.remove(key)};
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const {alpha, mount, editor} = await mountEditor(store);
    try {
        expect(alpha.dataset.clozeDisplay).toBe('normal');
        expect(mount.querySelectorAll<HTMLElement>('.mdx-cloze')[1].dataset.clozeDisplay).toBe('hidden');
        expect(errorLog.mock.calls[0][1]).toMatchObject({stage: 'read', code: 'EIO', result: 'failure'});
        expect(JSON.stringify(errorLog.mock.calls)).not.toContain('private document path');
        await editor.switchToMode('edit');
        await editor.switchToMode('render');
        expect(mount.querySelector<HTMLElement>('.mdx-cloze')!.dataset.clozeDisplay).toBe('open');
    } finally {await editor.destroy();}
});

it.each(['missing', 'throwing'])('saves display preferences when native randomUUID is %s', async native => {
    const randomUUID = vi.fn(() => {throw new Error('Native UUID unavailable');});
    vi.stubGlobal('crypto', {getRandomValues: crypto.getRandomValues.bind(crypto),
        randomUUID: native === 'missing' ? undefined : randomUUID});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {}), store = new MemoryStore();
    const {alpha, editor} = await mountEditor(store);
    try {
        selectMode(alpha, 'open');
        await vi.waitFor(() => expect(alpha.dataset.clozeDisplay).toBe('open'));
        expect(randomUUID).not.toHaveBeenCalled();
        const saved = info.mock.calls.find(([message]) => message === '[MemoryPlugin] Display preference saved');
        expect(saved?.[1].operationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    } finally {await editor.destroy();}
});
