// mdx/plugins/cloze/memory.plugin.ts
import type { MDxPlugin, PluginContext, ScopedPersistenceStore } from '../../core/types';
import { t } from '../../utils/i18n';
import { randomUUID } from '../../utils/random';
import {reviewSnapshot, withReviewHistory} from './review-history';
import {ClozeDisplayPreferences, setClozeVisible, type ClozeDisplayMode} from './display-state';

/** Payload version for one card entry; bump when SRSCardState changes and migrate on read. */
export const SRS_STORAGE_VERSION = 1;
/** Per-card keys keep writes small and let hosts enumerate state without one blob. */
export const SRS_CARD_PREFIX = 'card:';
/** Anki-style ceiling so repeated Easy grades cannot push a card years into the future. */
export const SRS_MAX_INTERVAL_DAYS = 36500;

/** Whole-map key written before per-card entries; read once, then migrated. */
const LEGACY_BLOB_KEY = '_mdx_srs';
const DAY_MS = 86_400_000;
const MINUTE_DAYS = 1 / 1440;
const TEN_MINUTES_DAYS = 10 / 1440;

export interface MemoryPluginOptions {
  gradingTimeout?: number;
  className?: string;
  /** 冷却时间（毫秒），点击 Again 后多久才能再次评分 */
  coolingPeriod?: number;
  /** 严重过期的天数阈值 */
  dangerThresholdDays?: number;
  /** 是否启用调试日志 */
  debug?: boolean;

  /**
   * 在到期前多少小时自动隐藏卡片（即使还没完全到期）。
   * @default 12
   */
  hideBeforeDueHours?: number;

  /** Injected clock in epoch milliseconds; keeps scheduling testable and host-controlled. */
  now?: () => number;

  /**
   * 单卡最大间隔（天）。
   * @default 36500
   */
  maxIntervalDays?: number;
}

export interface SRSCardState {
  /** Due date for next review */
  dueAt: string | null;
  /** Last review date */
  lastReviewedAt: string | null;
  /** Last grade given (1-4) */
  lastGrade: number | null;
  /** Number of times reviewed */
  reviewCount: number;
  /** Current interval in days */
  interval: number;
  /** Ease factor for SM-2 algorithm */
  easeFactor: number;
}

/**
 * SM-2 variant. Pure: `now` is injected so scheduling is reproducible and DST-safe.
 */
export function nextReview(current: SRSCardState | undefined, grade: number, now: number = Date.now(),
  maxIntervalDays: number = SRS_MAX_INTERVAL_DAYS): SRSCardState {
  const state: SRSCardState = current ? { ...current } : {
    dueAt: null, lastReviewedAt: null, lastGrade: null, reviewCount: 0, interval: 0, easeFactor: 2.5,
  };

  let nextInterval: number;
  if (grade === 1) {
    state.easeFactor = Math.max(1.3, state.easeFactor - 0.2);
    nextInterval = MINUTE_DAYS;
  } else if (state.interval < 1) {
    switch (grade) {
      case 2: nextInterval = MINUTE_DAYS * 5; break;
      case 3: nextInterval = state.interval >= TEN_MINUTES_DAYS * 0.9 ? 1 : TEN_MINUTES_DAYS; break;
      case 4: nextInterval = 4; break;
      default: nextInterval = MINUTE_DAYS;
    }
  } else {
    switch (grade) {
      case 2:
        state.easeFactor = Math.max(1.3, state.easeFactor - 0.15);
        nextInterval = state.interval * 1.2;
        break;
      case 3:
        nextInterval = state.interval * state.easeFactor;
        break;
      case 4:
        state.easeFactor += 0.15;
        nextInterval = state.interval * state.easeFactor * 1.3;
        break;
      default:
        nextInterval = 1;
    }
  }

  state.interval = Math.min(Math.max(nextInterval, MINUTE_DAYS), maxIntervalDays);
  state.lastReviewedAt = new Date(now).toISOString();
  state.lastGrade = grade;
  state.reviewCount++;
  state.dueAt = new Date(now + state.interval * DAY_MS).toISOString();
  return state;
}

function isSRSCardState(value: unknown): value is SRSCardState {
  if (typeof value !== 'object' || value === null) return false;
  const state = value as Record<string, unknown>;
  return (typeof state.dueAt === 'string' || state.dueAt === null)
    && (typeof state.lastReviewedAt === 'string' || state.lastReviewedAt === null)
    && (typeof state.lastGrade === 'number' || state.lastGrade === null)
    && typeof state.reviewCount === 'number'
    && typeof state.interval === 'number'
    && typeof state.easeFactor === 'number';
}

/** Accepts versioned entries and the unversioned shape written by earlier releases. */
export function readStoredCard(value: unknown): SRSCardState | undefined {
  if (!isSRSCardState(value)) return undefined;
  const version = (value as unknown as Record<string, unknown>).v;
  if (version !== undefined && (typeof version !== 'number' || version > SRS_STORAGE_VERSION)) return undefined;
  return {
    dueAt: value.dueAt, lastReviewedAt: value.lastReviewedAt, lastGrade: value.lastGrade,
    reviewCount: value.reviewCount, interval: value.interval, easeFactor: value.easeFactor,
  };
}

interface ClozeRevealedPayload {
  element: HTMLElement;
  clozeId: string;
}

// 状态定义：
// is-new: 新卡片 (Hidden)
// is-cooling: 冷却中 (Visible, 无菜单)
// is-learning: 学习中/短间隔 (Hidden)
// is-approaching: 已进入提前隐藏窗口但尚未到期 (Hidden)
// is-due: 到期 (Hidden)
// is-danger: 严重过期 (Hidden, 红色)
// is-cleared: 已掌握/Easy (Visible, 点击关闭，再次打开显示菜单)
type ClozeStateClass = 'is-new' | 'is-cooling' | 'is-learning' | 'is-approaching' | 'is-due' | 'is-danger' | 'is-cleared';
const VISIBLE_STATES = new Set<ClozeStateClass>(['is-cleared', 'is-cooling']);
const ALL_STATES: ClozeStateClass[] = ['is-new', 'is-cooling', 'is-learning', 'is-approaching', 'is-due', 'is-danger', 'is-cleared'];

export class MemoryPlugin implements MDxPlugin {
  name = 'cloze:memory';
  private options: Required<MemoryPluginOptions>;
  private cleanupFns: Array<() => void> = [];
  private clozeStatesCache = new WeakMap<PluginContext, Map<string, SRSCardState>>();
  /** Latest rendered root per context, so progress changes repaint without a re-render. */
  private roots = new WeakMap<PluginContext, HTMLElement>();
  private storeRef: ScopedPersistenceStore | null = null;
  private displayPreferences = new WeakMap<PluginContext, ClozeDisplayPreferences>();

  // [新增] 同步状态追踪
  private syncedContexts = new WeakSet<PluginContext>();
  private syncPromise: Promise<void> | null = null;

  constructor(options: MemoryPluginOptions = {}) {
    this.options = {
      gradingTimeout: options.gradingTimeout || 300000,
      className: options.className || 'mdx-memory',
      coolingPeriod: options.coolingPeriod || 60000, // 默认1分钟冷却
      dangerThresholdDays: options.dangerThresholdDays || 7, // 超过7天为严重过期
      debug: options.debug ?? false, // 🟢 默认开启调试，生产环境可关闭
      hideBeforeDueHours: options.hideBeforeDueHours ?? 12, // 默认提前12小时隐藏
      now: options.now ?? (() => Date.now()),
      maxIntervalDays: options.maxIntervalDays ?? SRS_MAX_INTERVAL_DAYS,
    };
  }

  private log(_message: string, ..._args: unknown[]) {
    if (this.options.debug) {
      //console.log(`🔮 [MemoryPlugin] ${message}`, ...args);
    }
  }

  private getCache(context: PluginContext): Map<string, SRSCardState> {
    if (!this.clozeStatesCache.has(context)) {
      this.clozeStatesCache.set(context, new Map());
    }
    return this.clozeStatesCache.get(context)!;
  }

  private cardKey(locator: string): string { return SRS_CARD_PREFIX + locator; }

  private nowMs(): number { return this.options.now(); }

  private translate(context: PluginContext, key: string): string {
    return context.translate?.(key) ?? t(key);
  }

  install(context: PluginContext): void {
    this.storeRef = context.getScopedStore();
    this.displayPreferences.set(context, new ClozeDisplayPreferences(this.storeRef, context));

    context.registerCommand?.('resetClozeProgress', async () => {
      await this.resetProgress(context, true);
      return true;
    });

    // Fixed cards open the menu without changing their answer visibility.
    const showMenu = (data: ClozeRevealedPayload) => {
      const isLocked = data.element.closest('.is-global-override');
      const timeout = isLocked ? 0 : this.options.gradingTimeout;

      this.showGradingPanel(data.element, context, timeout);
    };
    for (const event of ['clozeRevealed', 'clozeMenuRequested']) {
      const remove = context.listen(event, showMenu);
      if (remove) this.cleanupFns.push(remove);
    }

    // 批量评分支持
    const removeBatchToggle = context.listen('clozeBatchGradeToggle', (data: { container?: HTMLElement }) => {
      this.showBatchGrading(context, data.container);
    });
    if (removeBatchToggle) this.cleanupFns.push(removeBatchToggle);

    // 重置进度入口（宿主按钮或命令发出，避免插件互查命令）
    const removeReset = context.listen('clozeResetRequested', () => {
      void this.resetProgress(context, true).catch(error => {
        console.error('[MemoryPlugin] Reset failed', { operation: 'cloze.reset', stage: 'persist', result: 'failure',
          code: (error as { code?: string })?.code ?? 'CLOZE_RESET_FAILED' });
        context.notify(this.translate(context, 'cloze.reset.failed'), 'error');
      });
    });
    if (removeReset) this.cleanupFns.push(removeReset);

    // [优化] DOM 更新时的同步逻辑
    const removeDomUpdated = context.on('domUpdated', async ({ element }: { element: HTMLElement }) => {
      this.log('DOM updated, checking sync status...');

      // 只在首次加载时同步
      if (!this.syncedContexts.has(context)) {
        // 防止并发同步
        if (!this.syncPromise) {
          this.syncPromise = this.syncWithStore(context).finally(() => {
            this.syncPromise = null;
          });
        }
        await this.syncPromise;
        this.syncedContexts.add(context);
      }

      this.roots.set(context, element);
      await this.displayPreferences.get(context)?.load(element);
      this.adoptLegacyLocators(element, context);
      this.applyVisualsAndState(element, context);
    });
    if (removeDomUpdated) this.cleanupFns.push(removeDomUpdated);
  }

  /**
   * [新增] 强制重新同步方法（供外部调用）
   */
  async forceResync(context: PluginContext): Promise<void> {
    this.syncedContexts.delete(context);
    this.displayPreferences.get(context)?.clear();
    await this.syncWithStore(context);
    this.syncedContexts.add(context);
  }

  /** Read current and legacy progress without creating persistent records. */
  private async syncWithStore(context: PluginContext): Promise<void> {
    const cache = this.getCache(context);
    cache.clear();
    const store = this.storeRef;
    if (!store) return;

    try {
      if (store.entries) {
        for (const [key, value] of await store.entries(SRS_CARD_PREFIX)) {
          const state = readStoredCard(value);
          if (state) cache.set(key.slice(SRS_CARD_PREFIX.length), state);
          else console.warn('[MemoryPlugin] Unreadable card kept untouched:', key);
        }
        const legacy = await store.get(LEGACY_BLOB_KEY);
        if (typeof legacy === 'object' && legacy !== null) {
          this.loadLegacyBlob(legacy as Record<string, unknown>, cache);
        }
        this.log(`Synced ${cache.size} cards.`);
        return;
      }

      // Store without enumeration: keep reading the legacy whole-map value.
      const srsData = await store.get(LEGACY_BLOB_KEY);
      if (typeof srsData === 'object' && srsData !== null) {
        for (const [key, value] of Object.entries(srsData)) {
          const state = readStoredCard(value);
          if (state) cache.set(key, state);
        }
      }
    } catch (error) {
      console.warn('[MemoryPlugin] Sync error:', error);
    }
  }

  /** Read legacy progress without writes; only an actual grade creates a card entry. */
  private loadLegacyBlob(blob: Record<string, unknown>, cache: Map<string, SRSCardState>): void {
    for (const [locator, value] of Object.entries(blob)) {
      const state = readStoredCard(value);
      if (!state) { console.warn('[MemoryPlugin] Unreadable legacy card retained'); continue; }
      if (!cache.has(locator)) cache.set(locator, state);
    }
  }

  /** Write one card. Stores without enumeration keep a whole-map value for compatibility. */
  private async persistCard(locator: string, state: SRSCardState, context: PluginContext): Promise<void> {
    const store = this.storeRef;
    if (!store) return;
    const cache = this.getCache(context);
    const ids = [...(this.roots.get(context)?.querySelectorAll<HTMLElement>('[data-cloze-locator]') ?? [])]
      .map(element => element.dataset.clozeLocator!).filter(Boolean);
    if (!ids.includes(locator)) ids.push(locator);
    const snapshot = reviewSnapshot(ids, [...new Set(ids)].filter(id => cache.has(id)).length);
    if (store.entries) {
      const raw = await store.get(this.cardKey(locator));
      await store.set(this.cardKey(locator), { v: SRS_STORAGE_VERSION, ...withReviewHistory(raw, state, snapshot, cache.has(locator)) });
      return;
    }
    const existing = await store.get(LEGACY_BLOB_KEY);
    const blob: Record<string, unknown> = typeof existing === 'object' && existing !== null
      ? { ...(existing as Record<string, unknown>) } : {};
    blob[locator] = withReviewHistory(blob[locator], state, snapshot, cache.has(locator));
    await store.set(LEGACY_BLOB_KEY, blob);
  }

  /** Retire only the successfully changed legacy card; unreadable entries stay intact. */
  private async retireLegacyCard(locator: string, legacyLocator: string | null): Promise<void> {
    const store = this.storeRef;
    if (!store?.entries) return;
    if (legacyLocator && readStoredCard(await store.get(this.cardKey(legacyLocator))))
      await store.remove(this.cardKey(legacyLocator));
    const existing = await store.get(LEGACY_BLOB_KEY);
    if (typeof existing !== 'object' || existing === null) return;
    const blob = { ...(existing as Record<string, unknown>) };
    let changed = false;
    for (const key of new Set([locator, legacyLocator])) {
      if (key && readStoredCard(blob[key])) { delete blob[key]; changed = true; }
    }
    if (!changed) return;
    if (Object.keys(blob).length) await store.set(LEGACY_BLOB_KEY, blob);
    else await store.remove(LEGACY_BLOB_KEY);
  }

  /** Adopt progress written under the pre-hash positional id (`auto-<n>`). */
  private adoptLegacyLocators(element: HTMLElement, context: PluginContext): void {
    const cache = this.getCache(context);
    for (const cloze of Array.from(element.querySelectorAll<HTMLElement>('[data-cloze-legacy-locator]'))) {
      const locator = cloze.getAttribute('data-cloze-locator');
      const legacy = cloze.getAttribute('data-cloze-legacy-locator');
      if (!locator || !legacy || cache.has(locator)) continue;
      const state = cache.get(legacy);
      if (!state) continue;
      cache.set(locator, state);
    }
  }

  /** Clear all review progress for this document (command, host button or event). */
  async resetProgress(context: PluginContext, confirm = false): Promise<void> {
    if (confirm && typeof window !== 'undefined' && typeof window.confirm === 'function'
      && !window.confirm(this.translate(context, 'cloze.reset.confirm'))) return;
    const cache = this.getCache(context);
    const store = this.storeRef;
    if (store?.entries) {
      for (const [key] of await store.entries(SRS_CARD_PREFIX)) await store.remove(key);
    }
    if (store) await store.remove(LEGACY_BLOB_KEY);
    cache.clear();
    const root = this.roots.get(context);
    if (root) this.applyVisualsAndState(root, context);
    context.notify(this.translate(context, 'cloze.reset.done'), 'success');
  }

  /**
   * 核心状态判定逻辑
   */
  private determineStateClass(state: SRSCardState | undefined): ClozeStateClass {
    // 1. 新卡片 -> Blue
    if (!state || state.reviewCount === 0) {
      return 'is-new';
    }

    const nowMs = this.nowMs();
    const dueMs = state.dueAt ? Date.parse(state.dueAt) : nowMs;
    const lastMs = state.lastReviewedAt ? Date.parse(state.lastReviewedAt) : null;

    // 2. 冷却逻辑
    // 如果是刚刚复习过的短间隔卡片，且在冷却期内，保持 is-cooling (显示)
    if (state.interval * DAY_MS < this.options.coolingPeriod * 2) {
      if (lastMs !== null && dueMs > nowMs && nowMs - lastMs < this.options.coolingPeriod) {
        return 'is-cooling';
      }
    }

    // 3. 计算“提前隐藏”逻辑
    const timeRemaining = dueMs - nowMs;
    const safetyThreshold = this.options.hideBeforeDueHours * 60 * 60 * 1000;

    // 4. 只有当剩余时间 大于 阈值 (12小时) 时，才显示内容
    if (timeRemaining > safetyThreshold) {
      return 'is-cleared';
    }

    // 5. 否则，进入隐藏状态 (包含 Learning, Approaching, Due, Danger)

    // 学习中 (间隔小于1天)
    if (state.interval < 1) {
      return 'is-learning';
    }

    // 提前隐藏窗口内但尚未到期：与 is-due 分开，避免把“快到期”报成“已过期”
    if (timeRemaining > 0) {
      return 'is-approaching';
    }

    // 严重过期
    const overdueDays = -timeRemaining / DAY_MS;
    if (overdueDays >= this.options.dangerThresholdDays) {
      return 'is-danger';
    }

    // 普通到期
    return 'is-due';
  }

  /**
   * --- 关键逻辑 2: 应用视觉状态 ---
   * 负责初始化 DOM 时的显隐控制
   */
  private applyVisualsAndState(element: HTMLElement, context: PluginContext): void {
    const isGlobalLocked = element.classList.contains('is-global-override') ||
      !!element.closest('.is-global-override');
    const cache = this.getCache(context);
    const clozes = element.querySelectorAll('.mdx-cloze');

    let matchedCount = 0;

    clozes.forEach(cloze => {
      const locator = cloze.getAttribute('data-cloze-locator');
      if (!locator) return;

      const state = cache.get(locator);

      if (state) matchedCount++;

      const stateClass = this.determineStateClass(state);

      // 1. 更新 CSS 类
      cloze.classList.remove(...ALL_STATES);
      cloze.classList.add(stateClass);

      // 2. 存储状态到 dataset，供点击事件使用
      (cloze as HTMLElement).dataset.stateClass = stateClass;

      // Persistent display preferences take precedence over temporary global overrides.
      setClozeVisible(cloze, isGlobalLocked ? !cloze.classList.contains('hidden') : VISIBLE_STATES.has(stateClass));
    });

    this.log(`Applied visuals. Found ${clozes.length} clozes in DOM. Matched ${matchedCount} from Store.`);
  }

  /** Human-readable interval so a grade label states the real next gap. */
  private formatInterval(intervalDays: number, context: PluginContext): string {
    if (intervalDays < 1 / 24) return `${Math.max(1, Math.round(intervalDays * 1440))}${this.translate(context, 'cloze.unit.minute')}`;
    if (intervalDays < 1) return `${Math.max(1, Math.round(intervalDays * 24))}${this.translate(context, 'cloze.unit.hour')}`;
    return `${Math.round(intervalDays)}${this.translate(context, 'cloze.unit.day')}`;
  }

  private gradeLabel(grade: number, context: PluginContext, current: SRSCardState | undefined): string {
    const keys = ['cloze.grade.again', 'cloze.grade.hard', 'cloze.grade.good', 'cloze.grade.easy'];
    const next = nextReview(current, grade, this.nowMs(), this.options.maxIntervalDays);
    return `${this.translate(context, keys[grade - 1] ?? 'cloze.grade.good')} (${this.formatInterval(next.interval, context)})`;
  }

  private showGradingPanel(clozeElement: HTMLElement, context: PluginContext, timeoutDuration: number = 0): void {
    const locator = clozeElement.getAttribute('data-cloze-locator');
    if (locator && this.displayPreferences.get(context)?.isSaving(locator)) return;
    const existing = clozeElement.querySelector(`.${this.options.className}__panel`);
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.className = `${this.options.className}__panel`;
    // 阻止冒泡非常重要，否则点击按钮会触发 ClozePlugin 的 toggle，导致卡片立马关上
    panel.addEventListener('click', (e) => e.stopPropagation());

    const current = locator ? this.getCache(context).get(locator) : undefined;
    // Cooling cards keep display actions available without enabling another review.
    const grades = clozeElement.dataset.stateClass === 'is-cooling' ? [] : [1, 2, 3, 4];
    panel.innerHTML = grades.map(grade => {
      const label = this.gradeLabel(grade, context, current);
      return `<button data-grade="${grade}" title="${label}">${label}</button>`;
    }).join('') + this.displayButtons(clozeElement, context);

    this.bindGradingPanel(panel, clozeElement, context, timeoutDuration);
    clozeElement.appendChild(panel);
  }

  private bindGradingPanel(panel: HTMLElement, element: HTMLElement, context: PluginContext, duration: number): void {
    const timeout = duration > 0 ? setTimeout(() => panel.remove(), duration) : null;
    panel.addEventListener('click', async (e) => {
      const btn = (e.target as HTMLElement).closest('button');
      if (!btn || btn.disabled) return;
      if (timeout) clearTimeout(timeout);
      const mode = btn.getAttribute('data-display');
      if (mode === 'normal' || mode === 'open' || mode === 'hidden') {
        await this.changeDisplay(element, mode, context, panel);
        return;
      }
      const grade = Number(btn.getAttribute('data-grade'));
      if (!Number.isInteger(grade) || grade < 1 || grade > 4) return;
      panel.remove();
      await this.gradeCard(element, grade, context);
    });
  }

  private displayButtons(element: HTMLElement, context: PluginContext): string {
    return (['normal', 'open', 'hidden'] as const).map(mode => {
      const label = this.translate(context, `cloze.display.${mode}`);
      const selected = (element.dataset.clozeDisplay ?? 'normal') === mode;
      return `<button type="button" data-display="${mode}" aria-pressed="${selected}" title="${label}">${label}</button>`;
    }).join('');
  }

  private async changeDisplay(element: HTMLElement, mode: ClozeDisplayMode, context: PluginContext, panel: HTMLElement): Promise<void> {
    const locator = element.dataset.clozeLocator, root = this.roots.get(context);
    if (!locator || !root) return;
    panel.querySelectorAll('button').forEach(button => button.disabled = true);
    const saved = await this.displayPreferences.get(context)?.save(locator, mode, root);
    if (saved) {
      panel.remove();
      const currentRoot = this.roots.get(context) ?? root;
      await this.displayPreferences.get(context)?.load(currentRoot);
      for (const cloze of currentRoot.querySelectorAll<HTMLElement>('[data-cloze-locator]')) {
        if (cloze.dataset.clozeLocator !== locator) continue;
        const stateClass = this.determineStateClass(this.getCache(context).get(locator));
        setClozeVisible(cloze, VISIBLE_STATES.has(stateClass));
      }
    } else panel.querySelectorAll('button').forEach(button => button.disabled = false);
  }

  private showBatchGrading(context: PluginContext, container?: HTMLElement): void {
    const scope = container || document;
    // 排除冷却中的卡片
    const clozes = scope.querySelectorAll('.mdx-cloze:not(.hidden):not(.is-cooling)');
    clozes.forEach(cloze => {
      this.showGradingPanel(cloze as HTMLElement, context, 0);
    });
  }

  private async gradeCard(clozeElement: HTMLElement, grade: number, context: PluginContext): Promise<void> {
    const locator = clozeElement.getAttribute('data-cloze-locator');
    if (!locator) return;

    const operationId = randomUUID(), started = Date.now();
    try {
      const cache = this.getCache(context);
      const currentState = cache.get(locator);
      const newState = nextReview(currentState, grade, this.nowMs(), this.options.maxIntervalDays);

      // Commit storage before changing the in-memory review state.
      await this.persistCard(locator, newState, context);
      cache.set(locator, newState);
      try { await this.retireLegacyCard(locator, clozeElement.getAttribute('data-cloze-legacy-locator')); }
      catch { console.warn('[MemoryPlugin] Legacy cleanup deferred', { operationId, stage: 'legacy-cleanup',
        result: 'failure', code: 'CLOZE_LEGACY_CLEANUP_FAILED', durationMs: Date.now() - started }); }

      // 3. 立即更新视觉
      clozeElement.classList.remove(...ALL_STATES);
      const stateClass = this.determineStateClass(newState);
      clozeElement.classList.add(stateClass);
      clozeElement.dataset.stateClass = stateClass;

      // --- 关键逻辑 3: 评分后的显隐控制 ---
      // 如果变成了 is-cleared (Easy/Good) 或 is-cooling (Again)
      // 强制保持打开状态 (remove hidden)
      // 此时因为不是通过 ClozePlugin 的 click 触发的，所以不会发 clozeRevealed 事件，也就不会再次显示 Panel
      if (VISIBLE_STATES.has(stateClass)) {
        setClozeVisible(clozeElement, true);
      }

      this.log('Grade committed', { operationId, stage: 'persist', result: 'success', durationMs: Date.now() - started });
    } catch (error) {
      const code = (error as { code?: string })?.code;
      console.error('[MemoryPlugin] Grade failed', { operation: 'cloze.grade', stage: 'persist',
        result: 'failure', operationId, durationMs: Date.now() - started,
        code: typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(code) ? code : 'CLOZE_WRITE_FAILED' });
      context.notify(this.translate(context, 'cloze.grade.failed') + (typeof code === 'string' ? ` (${code})` : ''), 'error');
    }
  }

  destroy(): void {
    this.cleanupFns.forEach(fn => fn());
    this.cleanupFns = [];
    this.storeRef = null;
    this.syncPromise = null;
  }
}
