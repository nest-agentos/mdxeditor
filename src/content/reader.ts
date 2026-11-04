import {MDxRenderer} from '../renderer/mdx-renderer';
import type {AssetProvider} from '../editor/contracts';
import type {MDxPlugin} from '../core/types';
export interface ContentReaderOptions {format?: 'text' | 'markdown'; assets?: AssetProvider; signal?: AbortSignal; documentPath?: string; plugins?: readonly MDxPlugin[]}
/** Plain text has a first-class read view; Markdown retains the streaming renderer. */
export class ContentReader {
    private renderer?: MDxRenderer;
    private text = '';
    private tail = Promise.resolve();
    private closed = false;
    constructor(readonly element: HTMLElement, private readonly options: ContentReaderOptions = {}) {
        element.classList.add('mdx-content-reader');
        if (options.format === 'text') element.classList.add('mdx-content-reader--text');
    }
    setText(text: string, streaming = false): Promise<void> {
        this.text = text;
        const task = this.tail.catch(() => {}).then(async () => {
            if (this.closed || this.options.signal?.aborted) return;
            if (this.options.format === 'text') {this.element.textContent = text; return;}
            if (!this.renderer) {
                this.renderer = new MDxRenderer({htmlPolicy: 'literal', assets: this.options.assets, signal: this.options.signal, documentPath: this.options.documentPath});
                for (const plugin of this.options.plugins ?? []) this.renderer.usePlugin(plugin);
            }
            if (streaming) await this.renderer.renderStreaming(this.element, text);
            else await this.renderer.render(this.element, text);
        });
        this.tail = task; return task;
    }
    getText(): string {return this.text;}
    async destroy(): Promise<void> {this.closed = true; await this.tail.catch(() => {}); this.renderer?.destroy();}
}
