import {t} from '../utils/i18n';
import type {ContentListView} from './list';
export interface ContentSelection {readonly text: string; readonly items: readonly {readonly id: string; readonly text: string}[]}
export interface ContentSelectionOptions {
    label?: string; locale?: 'zh-CN' | 'en'; run(selection: ContentSelection, signal: AbortSignal): Promise<void>;
    onError?(error: unknown): void;
}
/** A frozen selection is submitted only by an explicit click; the host owns execution. */
export class ContentSelectionAction {
    readonly button = document.createElement('button');
    private readonly abort = new AbortController();
    private selection?: ContentSelection;
    private active = true;
    private busy = false;
    private running?: AbortController;
    constructor(private readonly list: ContentListView, private readonly options: ContentSelectionOptions) {
        this.button.type = 'button'; this.button.className = 'mdx-content-selection'; this.button.textContent = options.label ?? t('editor.content.ai', options.locale);
        this.button.hidden = true; document.body.append(this.button);
        document.addEventListener('selectionchange', () => this.refresh(), {signal: this.abort.signal});
        list.element.addEventListener('mdx:content-list-change', () => this.refresh(), {signal: this.abort.signal});
        list.element.addEventListener('mdx:content-expanded', () => this.refresh(), {signal: this.abort.signal});
        document.addEventListener('scroll', () => this.refresh(), {signal: this.abort.signal, capture: true});
        document.addEventListener('pointerup', () => this.refresh(), {signal: this.abort.signal});
        this.button.addEventListener('pointerdown', event => event.preventDefault(), {signal: this.abort.signal});
        this.button.addEventListener('click', () => {void this.run();}, {signal: this.abort.signal});
    }
    refresh(): void {
        if (this.busy) return;
        const selected = document.getSelection();
        const next = this.active && this.list.element.isConnected && selected?.rangeCount && !selected.isCollapsed
            ? readContentSelection(this.list, selected.getRangeAt(0)) : undefined;
        if (!sameSelection(this.selection, next)) this.selection = next;
        this.button.hidden = !this.selection;
        if (!this.selection || !selected) return;
        const range = selected.getRangeAt(0), rect = range.getBoundingClientRect();
        this.button.style.left = `${Math.max(8, Math.min(rect.right, innerWidth - 100))}px`;
        this.button.style.top = `${Math.max(8, Math.min(rect.bottom + 8, innerHeight - 48))}px`;
    }
    private async run(): Promise<void> {
        const selection = this.selection; if (!selection || this.busy || !this.active) return;
        const running = this.running = new AbortController();
        this.busy = true; this.button.disabled = true;
        try {await this.options.run(selection, running.signal); if (this.selection === selection) {this.selection = undefined; this.button.hidden = true;}}
        catch (error) {if (!this.abort.signal.aborted && !running.signal.aborted) this.options.onError?.(error);}
        finally {this.running = undefined; this.busy = false; this.button.disabled = false;}
    }
    setActive(active: boolean): void {this.active = active; if (!active) {this.running?.abort(); this.selection = undefined; this.button.hidden = true;}}
    destroy(): void {this.running?.abort(); this.abort.abort(); this.button.remove(); this.selection = undefined;}
}
export function readContentSelection(list: ContentListView, range: Range): ContentSelection | undefined {
    const items = list.getItems().flatMap(({id, view}) => {
        if (!view.getExpanded() || !range.intersectsNode(view.body)) return [];
        const clipped = range.cloneRange(), body = document.createRange(); body.selectNodeContents(view.body);
        if (clipped.compareBoundaryPoints(Range.START_TO_START, body) < 0) clipped.setStart(body.startContainer, body.startOffset);
        if (clipped.compareBoundaryPoints(Range.END_TO_END, body) > 0) clipped.setEnd(body.endContainer, body.endOffset);
        const text = visibleSelectedText(view.body, clipped); return text.trim() ? [Object.freeze({id, text})] : [];
    });
    return items.length ? Object.freeze({items: Object.freeze(items), text: items.map(item => item.text).join('\n\n')}) : undefined;
}

function visibleSelectedText(root: HTMLElement, range: Range): string {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), pieces: string[] = [];
    let current: Node | null, previousBlock: Element | null = null;
    while ((current = walker.nextNode())) {
        if (!range.intersectsNode(current) || !visible(current, root)) continue;
        const start = range.startContainer === current ? range.startOffset : 0;
        const end = range.endContainer === current ? range.endOffset : current.textContent?.length;
        const text = current.textContent?.slice(start, end) ?? ''; if (!text) continue;
        const block = current.parentElement?.closest('p,li,pre,div,h1,h2,h3,h4,h5,h6') ?? null;
        if (pieces.length && block !== previousBlock) pieces.push('\n');
        pieces.push(text); previousBlock = block;
    }
    return pieces.join('');
}
function visible(text: Node, root: HTMLElement): boolean {
    for (let parent = text.parentElement; parent; parent = parent.parentElement) {
        if (parent.hidden || getComputedStyle(parent).display === 'none' || getComputedStyle(parent).visibility === 'hidden') return false;
        if (parent instanceof HTMLDetailsElement && !parent.open && !parent.querySelector(':scope > summary')?.contains(text)) return false;
        if (parent === root) break;
    }
    return true;
}

function sameSelection(first?: ContentSelection, second?: ContentSelection): boolean {
    if (!first || !second) return first === second;
    return first.items.length === second.items.length && first.items.every((item, index) => item.id === second.items[index].id && item.text === second.items[index].text);
}
