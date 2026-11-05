import type {PluginContext, ScopedPersistenceStore} from '../../core/types';
import {t} from '../../utils/i18n';
import {randomUUID} from '../../utils/random';
import {ACTION_ICONS} from '../../utils/icons';

export type ClozeDisplayMode = 'normal' | 'open' | 'hidden';
export const CLOZE_DISPLAY_PREFIX = 'display:';

/** Display preferences are independent of grades, review history and scheduling. */
export function readDisplayMode(value: unknown): ClozeDisplayMode {
    if (value === undefined || value === null) return 'normal';
    const record = value as {v?: unknown; mode?: unknown};
    if (record.v !== 1 || (record.mode !== 'open' && record.mode !== 'hidden'))
        throw Object.assign(new Error('Unsupported cloze display preference'), {code: 'CLOZE_DISPLAY_INVALID'});
    return record.mode;
}

export function storedDisplayMode(mode: ClozeDisplayMode): {v: 1; mode: 'open' | 'hidden'} | undefined {
    return mode === 'normal' ? undefined : {v: 1, mode};
}

/** Every visibility entry point respects the persistent per-card override. */
export function setClozeVisible(element: Element, visible: boolean): void {
    const mode = element.getAttribute('data-cloze-display');
    element.classList.toggle('hidden', mode === 'hidden' || (mode !== 'open' && !visible));
}

/** Keep a keyboard-accessible mode indicator outside the hidden answer content. */
function applyDisplayMode(element: HTMLElement, mode: ClozeDisplayMode, context: PluginContext): void {
    element.dataset.clozeDisplay = mode;
    element.querySelector(':scope > .mdx-cloze__display-indicator')?.remove();
    if (mode === 'normal') return;
    const indicator = document.createElement('button');
    indicator.type = 'button';
    indicator.className = 'mdx-cloze__display-indicator';
    const key = `cloze.display.${mode}Hint`;
    indicator.title = context.translate?.(key) ?? t(key);
    indicator.setAttribute('aria-label', indicator.title);
    indicator.innerHTML = mode === 'open' ? ACTION_ICONS.pin : ACTION_ICONS.lock;
    element.append(indicator);
}

export class ClozeDisplayPreferences {
    private modes = new Map<string, ClozeDisplayMode>();
    private enumerated = false;
    private pending = new Set<string>();
    constructor(private store: ScopedPersistenceStore, private context: PluginContext) {}

    clear(): void { this.modes.clear(); this.enumerated = false; }
    isSaving(locator: string): boolean { return this.pending.has(locator); }

    private report(error: unknown, operationId: string, stage: string, started: number): void {
        const raw = (error as {code?: unknown})?.code;
        const code = typeof raw === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(raw) ? raw : 'CLOZE_DISPLAY_FAILED';
        console.error('[MemoryPlugin] Display preference failed', {operation: 'cloze.display', operationId,
            stage, result: 'failure', code, durationMs: Date.now() - started});
        const key = stage === 'persist' ? 'cloze.display.saveFailed' : 'cloze.display.loadFailed';
        this.context.notify((this.context.translate?.(key) ?? t(key)) + ` (${code})`, 'error');
    }

    private decode(locator: string, value: unknown, operationId: string, started: number): void {
        try { this.modes.set(locator, readDisplayMode(value)); }
        catch (error) {
            this.modes.set(locator, 'normal');
            this.report(error, operationId, 'decode', started);
        }
    }

    private async loadOne(locator: string, operationId: string, started: number): Promise<void> {
        try { this.decode(locator, await this.store.get(CLOZE_DISPLAY_PREFIX + locator), operationId, started); }
        catch (error) { this.report(error, operationId, 'read', started); }
    }

    async load(root: HTMLElement): Promise<void> {
        const operationId = randomUUID(), started = Date.now();
        try {
            if (this.store.entries && !this.enumerated) {
                for (const [key, value] of await this.store.entries(CLOZE_DISPLAY_PREFIX))
                    this.decode(key.slice(CLOZE_DISPLAY_PREFIX.length), value, operationId, started);
                this.enumerated = true;
            }
            for (const element of root.querySelectorAll<HTMLElement>('[data-cloze-locator]')) {
                const locator = element.dataset.clozeLocator!;
                if (!this.enumerated && !this.modes.has(locator))
                    await this.loadOne(locator, operationId, started);
                applyDisplayMode(element, this.modes.get(locator) ?? 'normal', this.context);
            }
        } catch (error) { this.report(error, operationId, 'read', started); }
    }

    async save(locator: string, mode: ClozeDisplayMode, root: HTMLElement): Promise<boolean> {
        if (this.pending.has(locator)) return false;
        this.pending.add(locator);
        const operationId = randomUUID(), started = Date.now();
        try {
            const value = storedDisplayMode(mode), key = CLOZE_DISPLAY_PREFIX + locator;
            if (value) await this.store.set(key, value); else await this.store.remove(key);
            this.modes.set(locator, mode);
            for (const element of root.querySelectorAll<HTMLElement>('[data-cloze-locator]'))
                if (element.dataset.clozeLocator === locator) applyDisplayMode(element, mode, this.context);
            console.info('[MemoryPlugin] Display preference saved', {operation: 'cloze.display', operationId,
                stage: 'persist', result: 'success', mode, durationMs: Date.now() - started});
            return true;
        } catch (error) { this.report(error, operationId, 'persist', started); return false; }
        finally { this.pending.delete(locator); }
    }
}
