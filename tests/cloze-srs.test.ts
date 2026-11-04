// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryPlugin, nextReview, readStoredCard, SRS_CARD_PREFIX, SRS_STORAGE_VERSION,
  type SRSCardState } from '../src/plugins/cloze/memory.plugin';
import { builtinTokenizer, clozeLocatorId } from '../src/renderer/worker-tokenizers';
import { createMDxEditor } from '../src/factory';
import { MemoryStore } from '../src/core/store/memory-store';
import type { ScopedPersistenceStore } from '../src/core/types';

const HOUR = 3600_000;
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 0, 10, 8, 0, 0);

function card(overrides: Partial<SRSCardState> = {}): SRSCardState {
  return { dueAt: new Date(NOW + 30 * DAY).toISOString(), lastReviewedAt: new Date(NOW - DAY).toISOString(),
    lastGrade: 3, reviewCount: 3, interval: 30, easeFactor: 2.5, ...overrides };
}

beforeEach(() => vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} })));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.replaceChildren(); });

it('schedules from the injected clock and clamps the interval ceiling', () => {
  const learning = nextReview(undefined, 3, NOW);
  expect(learning.interval).toBeCloseTo(10 / 1440, 8);
  expect(learning.dueAt).toBe(new Date(NOW + 10 * 60_000).toISOString());

  const graduated = nextReview(learning, 3, NOW);
  expect(graduated.interval).toBe(1);
  expect(graduated.reviewCount).toBe(2);

  const capped = nextReview(card({ interval: 900, easeFactor: 3 }), 4, NOW, 1000);
  expect(capped.interval).toBe(1000);
  expect(capped.dueAt).toBe(new Date(NOW + 1000 * DAY).toISOString());

  const lapsed = nextReview(card(), 1, NOW);
  expect(lapsed.easeFactor).toBeCloseTo(2.3, 8);
  expect(lapsed.interval).toBeCloseTo(1 / 1440, 8);
});

it('keeps card identity stable across insertions and disambiguates duplicates by occurrence', () => {
  const tokenize = () => builtinTokenizer('cloze:cloze');
  const first = tokenize();
  expect(first('--alpha--').locator).toBe(clozeLocatorId('alpha', 0));
  expect(first('--beta--').locator).toBe(clozeLocatorId('beta', 0));
  // Same content later in the document keeps its own id; a duplicate gets an occurrence suffix.
  expect(first('--alpha--').locator).toBe(clozeLocatorId('alpha', 1));
  expect(first('--[explicit] alpha--').locator).toBe('explicit');
  expect(first('--[explicit] alpha--').legacyLocator).toBeUndefined();
  // Content hash, not position: inserting another cloze above does not move alpha's id.
  expect(tokenize()('--alpha--').locator).toBe(clozeLocatorId('alpha', 0));
  expect(tokenize()('--alpha--').legacyLocator).toBe('auto-0');
});

it('rejects payloads from a newer schema instead of silently downcasting them', () => {
  expect(readStoredCard({ v: SRS_STORAGE_VERSION, ...card() })).toMatchObject({ interval: 30 });
  expect(readStoredCard(card())).toMatchObject({ interval: 30 });
  expect(readStoredCard({ v: SRS_STORAGE_VERSION + 1, ...card() })).toBeUndefined();
  expect(readStoredCard({ ...card(), interval: '30' })).toBeUndefined();
});

it('loads legacy progress without writes and migrates only the graded card', async () => {
  const mount = document.createElement('div'); document.body.append(mount);
  const store = new MemoryStore();
  await store.set('_mdx_srs', { 'auto-0': card({ interval: 12, reviewCount: 2 }) });
  const writes: string[] = [];
  const spied: ScopedPersistenceStore = {
    get: key => store.get(key), set: async (key, value) => { writes.push(key); await store.set(key, value); },
    remove: key => store.remove(key), entries: prefix => store.entries!(prefix),
  };
  const editor = await createMDxEditor(mount, {
    initialContent: '--alpha-- and --beta--', initialMode: 'render', storeFactory: () => spied,
    plugins: ['cloze:cloze'], defaultPluginOptions: { 'cloze:memory': { now: () => NOW } },
  });
  try {
    const alpha = mount.querySelector<HTMLElement>(`[data-cloze-locator="${clozeLocatorId('alpha', 0)}"]`)!;
    // Legacy `auto-0` progress is adopted by the first auto-generated cloze.
    expect(alpha.className).toContain('is-cleared');
    const adopted = await store.get(SRS_CARD_PREFIX + clozeLocatorId('alpha', 0));
    expect(adopted).toBeUndefined();
    expect(writes).toEqual([]);
    expect(await store.get('_mdx_srs')).toBeDefined();
    expect(await store.get(SRS_CARD_PREFIX + 'auto-0')).toBeUndefined();

    // A cleared card is visible: the first click hides it, the second reveals and opens grading.
    alpha.click(); alpha.click();
    mount.querySelector<HTMLButtonElement>('.mdx-memory__panel button[data-grade="4"]')!.click();
    await vi.waitFor(async () => expect(await store.get(SRS_CARD_PREFIX + clozeLocatorId('alpha', 0)))
      .toMatchObject({ reviewCount: 3, lastGrade: 4 }));
    // Beta is untouched: grading writes exactly one key.
    expect(await store.get(SRS_CARD_PREFIX + clozeLocatorId('beta', 0))).toBeUndefined();
    expect(writes.every(key => key.startsWith(SRS_CARD_PREFIX))).toBe(true);
    await vi.waitFor(async () => expect(await store.get('_mdx_srs')).toBeUndefined());
  } finally { await editor.destroy(); }
});

it('separates approaching from due and reports the real next interval on the buttons', async () => {
  const mount = document.createElement('div'); document.body.append(mount);
  const store = new MemoryStore();
  await store.set(SRS_CARD_PREFIX + clozeLocatorId('soon', 0),
    { v: SRS_STORAGE_VERSION, ...card({ dueAt: new Date(NOW + 5 * HOUR).toISOString(), interval: 30 }) });
  await store.set(SRS_CARD_PREFIX + clozeLocatorId('late', 0),
    { v: SRS_STORAGE_VERSION, ...card({ dueAt: new Date(NOW - 10 * DAY).toISOString(), interval: 30 }) });
  const editor = await createMDxEditor(mount, {
    initialContent: '--soon-- and --late--', initialMode: 'render', storeFactory: () => store,
    plugins: ['cloze:cloze'], defaultPluginOptions: { 'cloze:memory': { now: () => NOW } },
  });
  try {
    expect(mount.querySelector<HTMLElement>(`[data-cloze-locator="${clozeLocatorId('soon', 0)}"]`)!.className)
      .toContain('is-approaching');
    expect(mount.querySelector<HTMLElement>(`[data-cloze-locator="${clozeLocatorId('late', 0)}"]`)!.className)
      .toContain('is-danger');

    const late = mount.querySelector<HTMLElement>(`[data-cloze-locator="${clozeLocatorId('late', 0)}"]`)!;
    late.click();
    const labels = [...late.querySelectorAll('.mdx-memory__panel button')].map(button => button.textContent);
    // 30 days at ease 2.5 → 75 days for Good, not the hardcoded "tomorrow".
    expect(labels[2]).toContain('75');
  } finally { await editor.destroy(); }
});

it('clears stored progress through the documented reset command', async () => {
  const mount = document.createElement('div'); document.body.append(mount);
  const store = new MemoryStore();
  await store.set(SRS_CARD_PREFIX + clozeLocatorId('alpha', 0), { v: SRS_STORAGE_VERSION, ...card() });
  const plugin = new MemoryPlugin({ now: () => NOW });
  const editor = await createMDxEditor(mount, {
    initialContent: '--alpha--', initialMode: 'render', storeFactory: () => store,
    plugins: ['cloze:cloze', plugin],
  });
  try {
    const confirmed = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await (editor.commands['resetClozeProgress'] as () => Promise<boolean>)();
    expect(confirmed).toHaveBeenCalled();
    expect(await store.entries!(SRS_CARD_PREFIX)).toEqual([]);
    expect(mount.querySelector('.mdx-cloze')!.className).toContain('is-new');
  } finally { await editor.destroy(); }
});

it('prefers new progress and keeps unreadable legacy data while grading only one card', async () => {
  const mount = document.createElement('div'); document.body.append(mount);
  const store = new MemoryStore(), writes = vi.spyOn(store, 'set');
  await store.set('card:stable', { v: 1, ...card({ reviewCount: 10 }) });
  await store.set('_mdx_srs', { stable: card({ reviewCount: 2 }), future: { v: 2, ...card() } });
  writes.mockClear();
  const editor = await createMDxEditor(mount, { initialContent: '--[stable] alpha--', initialMode: 'render',
    plugins: ['cloze:cloze'], storeFactory: () => store });
  try {
    expect(writes).not.toHaveBeenCalled();
    expect(await store.get('card:stable')).toMatchObject({ reviewCount: 10 });
    const alpha = mount.querySelector<HTMLElement>('.mdx-cloze')!;
    alpha.click(); alpha.click();
    alpha.querySelector<HTMLButtonElement>('[data-grade="3"]')!.click();
    await vi.waitFor(async () => expect(await store.get('card:stable')).toMatchObject({ reviewCount: 11 }));
    await vi.waitFor(async () => expect(await store.get('_mdx_srs')).toEqual({ future: { v: 2, ...card() } }));
  } finally { await editor.destroy(); }
});

it('keeps the old review state after a failed grade and allows a retry', async () => {
  const mount = document.createElement('div'); document.body.append(mount);
  const store = new MemoryStore(), notify = vi.fn();
  vi.spyOn(store, 'set').mockRejectedValueOnce(Object.assign(new Error('private storage detail'), { code: 'EACCES' }));
  const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  const editor = await createMDxEditor(mount, { initialContent: '--alpha--', initialMode: 'render',
    plugins: ['cloze:cloze'], storeFactory: () => store, host: { notify } });
  try {
    const alpha = mount.querySelector<HTMLElement>('.mdx-cloze')!;
    alpha.click(); alpha.querySelector<HTMLButtonElement>('[data-grade="3"]')!.click();
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith(expect.stringContaining('EACCES'), 'error'));
    expect(alpha.classList.contains('is-new')).toBe(true);
    expect(await store.entries('card:')).toEqual([]);
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('private storage detail');
    alpha.click(); alpha.click(); alpha.querySelector<HTMLButtonElement>('[data-grade="3"]')!.click();
    await vi.waitFor(async () => expect(await store.get('card:' + clozeLocatorId('alpha', 0))).toMatchObject({ reviewCount: 1 }));
  } finally { await editor.destroy(); }
});
