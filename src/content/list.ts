import {WindowOutline, type OutlineItem} from '@nestos/ui-common';
import {ContentSelectionAction, type ContentSelectionOptions} from './selection';
import type {ContentView} from './view';
export interface ContentListItem {readonly id: string; readonly view: ContentView; readonly outlineName?: string}
export interface ContentListOptions {layout?: 'list' | 'host'; selection?: ContentSelectionOptions}
/** Stable ordered content frames; paging and grouped layouts remain host policies. */
export class ContentListView {
    readonly outline = new WindowOutline();
    private items: readonly ContentListItem[] = [];
    private selection?: ContentSelectionAction;
    private active = true;
    constructor(readonly element: HTMLElement = document.createElement('div'), private readonly options: ContentListOptions = {}) {
        element.classList.add('mdx-content-list'); this.configureSelection(options.selection);
    }
    sync(items: readonly ContentListItem[]): void {
        if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('CONTENT_DUPLICATE_ID');
        const retained = new Set(items.map(item => item.view));
        if (retained.size !== items.length) throw new Error('CONTENT_DUPLICATE_VIEW');
        for (const item of this.items) if (!retained.has(item.view)) item.view.element.remove();
        this.outline.clear();
        this.items = items.map(item => Object.freeze({...item}));
        for (const item of this.items) this.outline.register(item.id, () => item.outlineName, () => {
            item.view.setExpanded(true); return item.view.element;
        });
        for (const item of items) item.view.element.dataset.contentId = item.id;
        this.element.dispatchEvent(new CustomEvent('mdx:content-list-change'));
        if (this.options.layout === 'host') return;
        let cursor = this.element.firstChild;
        for (const item of items) {
            if (item.view.element !== cursor) this.element.insertBefore(item.view.element, cursor);
            cursor = item.view.element.nextSibling;
        }
    }
    getOutline(): readonly OutlineItem[] {return this.outline.items();}
    reveal(id: string): HTMLElement {return this.outline.reveal(id);}
    configureSelection(options?: ContentSelectionOptions): void {
        this.selection?.destroy(); this.selection = options ? new ContentSelectionAction(this, options) : undefined;
        this.selection?.setActive(this.active);
    }
    setActive(active: boolean): void {this.active = active; this.selection?.setActive(active);}
    getItems(): readonly ContentListItem[] {return [...this.items];}
    setExpanded(expanded: boolean): void {for (const item of this.items) item.view.setExpanded(expanded);}
    destroy(): void {this.selection?.destroy(); this.selection = undefined; this.items = []; this.outline.clear();}
}
