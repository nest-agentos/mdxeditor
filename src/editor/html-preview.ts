import {htmlPreviewFrame} from './html-document';
import {prepareHtmlDocument} from './html-policy';
import {HtmlRuntime} from './html-runtime';
import {randomUUID} from '../utils/random';
import {log} from '../utils/logger';

type Label = (key: string) => string;
/** The frame renders inert HTML. Authored code only executes in the interpreter's private realm. */
export class HtmlPreview {
    private release?: () => void;
    constructor(private label: Label) {}
    render(container: HTMLElement, source: string, refresh: () => Promise<void>): Promise<void> {
        this.destroy();
        const operationId = randomUUID(), started = performance.now(), lifetime = new AbortController();
        const frame = document.createElement('iframe'); frame.className = 'mdx-html-preview__frame';
        frame.title = this.label('editor.html.preview'); frame.setAttribute('sandbox', 'allow-same-origin'); frame.referrerPolicy = 'no-referrer';
        const toolbar = document.createElement('div'); toolbar.className = 'mdx-html-preview__toolbar';
        const button = document.createElement('button'); button.type = 'button'; button.textContent = this.label('editor.html.refresh');
        const status = document.createElement('span'); status.setAttribute('role', 'status'); toolbar.append(button, status);
        container.replaceChildren(toolbar, frame);
        button.addEventListener('click', () => {void refresh();}, {signal: lifetime.signal});
        return this.load(frame, status, source, operationId, started, lifetime);
    }
    private load(frame: HTMLIFrameElement, status: HTMLElement, source: string, operationId: string,
        started: number, lifetime: AbortController): Promise<void> {
        return new Promise(resolve => {
            const loading = new AbortController();
            let runtime: HtmlRuntime | undefined;
            const seen = new Set<string>();
            const issue = (code: string) => {
                if (lifetime.signal.aborted || seen.has(code)) return; seen.add(code);
                if (!['HTML_SCRIPT_FAILED', 'HTML_SCRIPT_TYPE_ERROR'].includes(code) || seen.size === 1) status.textContent = this.label(this.reason(code));
                log.warn('html.preview', {operationId, stage: 'execute', result: 'failure', code, durationMs: performance.now() - started});
            };
            const timer = window.setTimeout(() => {issue('HTML_PREVIEW_TIMEOUT'); runtime?.destroy(); loading.abort(); frame.remove(); resolve();}, 4000);
            this.release = () => {
                lifetime.abort(); loading.abort(); clearTimeout(timer); runtime?.destroy(); frame.remove(); resolve();
                log.debug('html.preview', {operationId, stage: 'dispose', result: 'success', durationMs: performance.now() - started});
            };
            this.initialize(frame, source, loading.signal, issue, instance => {runtime = instance;}).then(() => {
                if (!lifetime.signal.aborted && !loading.signal.aborted) {frame.dataset.htmlPreviewState = seen.size ? 'restricted' : 'ready'; log.debug('html.preview', {operationId, stage: 'ready', result: seen.size ? 'failure' : 'success', code: seen.size ? 'HTML_PREVIEW_READY_WITH_ERRORS' : 'HTML_PREVIEW_READY', durationMs: performance.now() - started});}
            }).catch(error => {runtime?.destroy(); if (loading.signal.aborted) return; issue(error instanceof Error && /^HTML_[A-Z_]+$/.test(error.message) ? error.message : 'HTML_PREVIEW_LOAD_FAILED');})
                .finally(() => {clearTimeout(timer); resolve();});
        });
    }
    private async initialize(frame: HTMLIFrameElement, source: string, signal: AbortSignal,
        issue: (code: string) => void, own: (runtime: HtmlRuntime) => void): Promise<void> {
        const prepared = prepareHtmlDocument(source);
        if (prepared.blocked) issue('HTML_RESOURCE_BLOCKED');
        await new Promise<void>((resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('HTML_PREVIEW_CANCELLED')), {once: true});
            frame.addEventListener('load', () => resolve(), {once: true, signal});
            frame.addEventListener('error', () => reject(new Error('HTML_PREVIEW_LOAD_FAILED')), {once: true, signal});
            frame.srcdoc = htmlPreviewFrame(prepared.html);
        });
        if (signal.aborted) return;
        const document = frame.contentDocument?.querySelector('iframe')?.contentDocument;
        if (!document?.body) throw new Error('HTML_PREVIEW_DOCUMENT_UNAVAILABLE');
        const runtime = new HtmlRuntime(document, issue); own(runtime);
        await runtime.start(prepared);
    }
    private reason(code: string): string {
        const exact: Record<string, string> = {
            HTML_CAPABILITY_BLOCKED: 'capabilityBlocked', HTML_ATTRIBUTE_BLOCKED: 'domBlocked', HTML_ELEMENT_BLOCKED: 'domBlocked',
            HTML_FORM_BLOCKED: 'formBlocked', HTML_DYNAMIC_SCRIPT_BLOCKED: 'dynamicScriptBlocked',
            HTML_SCRIPT_SYNTAX_ERROR: 'syntaxError', HTML_SCRIPT_REFERENCE_ERROR: 'referenceError',
        };
        const patterns = [['TIME_LIMIT', 'timeLimit'], ['MEMORY', 'memoryLimit'], ['UNSUPPORTED', 'unsupported'],
            ['LIMIT', 'unsupported'], ['BUDGET', 'unsupported'], ['BLOCKED', 'blocked'], ['TIMEOUT', 'timeout'], ['SCRIPT', 'scriptError']];
        return 'editor.html.' + (exact[code] ?? patterns.find(([pattern]) => code.includes(pattern))?.[1] ?? 'loadError');
    }
    destroy(): void {this.release?.(); this.release = undefined;}
}
