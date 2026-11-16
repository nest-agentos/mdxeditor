import type {QuickJSContext, QuickJSHandle, QuickJSRuntime, QuickJSWASMModule} from 'quickjs-emscripten-core';
import {HTML_GUEST} from './html-guest';
import {HtmlDom, type HtmlEvent, type HtmlIssue} from './html-dom';
import type {HtmlDocument, HtmlHandler} from './html-policy';

let modulePromise: Promise<QuickJSWASMModule> | undefined;
function interpreter(): Promise<QuickJSWASMModule> {
    return modulePromise ??= Promise.all([import('quickjs-emscripten-core'), import('@jitl/quickjs-singlefile-browser-release-sync')])
        .then(([core, variant]) => core.newQuickJSWASMModuleFromVariant(variant.default)).catch(() => {
            modulePromise = undefined; throw new Error('HTML_INTERPRETER_LOAD_FAILED');
        });
}

/** An isolated ECMAScript realm with no web APIs; the bridge marshals JSON only. */
export class HtmlRuntime {
    private runtime?: QuickJSRuntime;
    private context?: QuickJSContext;
    private dom: HtmlDom;
    private handles: QuickJSHandle[] = [];
    private callbacks = new Map<string, QuickJSHandle>();
    private timers = new Map<number, ReturnType<typeof setTimeout>>();
    private pending = 0;
    private nextTimer = 0;
    private deadline = 0;
    private running = false;
    private destroyed = false;
    private exhausted = false;
    constructor(private document: Document, private issue: HtmlIssue) {
        this.dom = new HtmlDom(document, issue);
        this.dom.onEvent = event => this.event(event);
        this.dom.onHandlers = handlers => this.enqueue(() => this.handlers(handlers));
    }
    async start(document: HtmlDocument): Promise<void> {
        const module = await interpreter(); if (this.destroyed) return;
        const runtime = this.runtime = module.newRuntime();
        runtime.setMemoryLimit(32 * 1024 * 1024); runtime.setMaxStackSize(512 * 1024);
        runtime.setInterruptHandler(() => this.destroyed || performance.now() > this.deadline);
        const context = this.context = runtime.newContext();
        const bridge = context.newFunction('bridge', encoded => context.newString(this.bridge(context.getString(encoded))));
        context.setProp(context.global, '__htmlBridge', bridge); bridge.dispose();
        this.evaluate(HTML_GUEST);
        for (const name of ['Dispatch', 'Handlers', 'Ready', 'Timer']) {
            const handle = context.getProp(context.global, '__html' + name); this.handles.push(handle); this.callbacks.set(name, handle);
        }
        this.handlers(document.handlers);
        const started = performance.now();
        for (const script of document.scripts) {
            if (this.destroyed) break;
            if (performance.now() - started > 300) {this.issue('HTML_SCRIPT_TIME_LIMIT'); this.destroy(); break;}
            this.evaluate(script);
        }
        if (!this.destroyed) this.call('Ready', [this.dom.id(this.document.body)]);
    }
    private bridge(encoded: string): string {
        try {
            if (encoded.length > 128_000) throw new Error('HTML_DOM_BUDGET_EXCEEDED');
            const [op, , name, args] = JSON.parse(encoded);
            if (op === 'clock') return JSON.stringify({value: performance.now()});
            if (op === 'timer') return JSON.stringify({value: this.timer(name, args)});
            if (op === 'deny') {this.issue('HTML_CAPABILITY_BLOCKED'); return JSON.stringify({error: 'HTML_CAPABILITY_BLOCKED'});}
            return this.dom.request(encoded);
        } catch (error) {
            const code = error instanceof Error && /^HTML_[A-Z_]+$/.test(error.message) ? error.message : 'HTML_BRIDGE_REQUEST_FAILED';
            this.issue(code); return JSON.stringify({error: code});
        }
    }
    private timer(name: string, args: number[]): number | null {
        if (!['clear', 'timeout', 'interval'].includes(name) || !Array.isArray(args)) throw new Error('HTML_TIMER_REQUEST_INVALID');
        const [value] = args;
        if (name === 'clear') {clearTimeout(this.timers.get(value)); this.timers.delete(value); return null;}
        if (this.timers.size >= 100) throw new Error('HTML_TIMER_LIMIT');
        const id = ++this.nextTimer, delay = Math.min(60_000, Math.max(name === 'interval' ? 16 : 0, Number(value) || 0));
        const tick = () => {
            if (name !== 'interval') this.timers.delete(id);
            if (this.destroyed) return;
            this.call('Timer', [id, performance.now()]);
            if (name === 'interval' && this.timers.has(id) && !this.destroyed) this.timers.set(id, setTimeout(tick, delay));
        };
        this.timers.set(id, setTimeout(tick, delay)); return id;
    }
    private enqueue(action: () => void): void {
        if (this.pending >= 100 || this.destroyed) {if (!this.destroyed) this.issue('HTML_CALLBACK_LIMIT'); return;}
        this.pending++;
        queueMicrotask(() => {this.pending--; if (!this.destroyed) action();});
    }
    private handlers(handlers: HtmlHandler[]): void {if (!this.destroyed) this.call('Handlers', [handlers]);}
    private event(event: HtmlEvent): number | void {
        if (this.destroyed) return;
        if (this.running) {this.enqueue(() => {this.event(event);}); return;}
        const result = this.call('Dispatch', [event.callback, event.node, event.event]);
        return typeof result === 'number' ? result & 7 : 0;
    }
    private evaluate(source: string): void {
        this.execute(() => {
            const result = this.context!.evalCode(source, 'html-inline.js', {type: 'global'});
            if (result.error) this.failure(result.error);
            else result.value.dispose();
        });
    }
    private call(name: string, values: unknown[]): unknown {
        const callback = this.callbacks.get(name), context = this.context;
        if (!callback || !context || this.destroyed) return;
        let returned: unknown;
        this.execute(() => {
            const json = context.newString(JSON.stringify(values));
            const parse = context.evalCode('JSON.parse');
            if (parse.error) {parse.error.dispose(); json.dispose(); return;}
            const parsed = context.callFunction(parse.value, context.undefined, json); parse.value.dispose(); json.dispose();
            if (parsed.error) {parsed.error.dispose(); return;}
            const args = values.map((_, index) => context.getProp(parsed.value, index)); parsed.value.dispose();
            const result = context.callFunction(callback, context.undefined, ...args); args.forEach(value => value.dispose());
            if (result.error) this.failure(result.error); else {returned = context.dump(result.value); result.value.dispose();}
        });
        return returned;
    }
    private failure(error: QuickJSHandle): void {
        let code = this.budgetCode();
        try {
            const details = this.context?.dump(error);
            if (details && ['SyntaxError', 'ReferenceError', 'TypeError'].includes(details.name)) code = 'HTML_SCRIPT_' + details.name.replace('Error', '').toUpperCase() + '_ERROR';
            if (details && typeof details.message === 'string' && details.message.includes('out of memory')) code = 'HTML_SCRIPT_MEMORY_LIMIT';
        } finally {error.dispose();}
        if (['HTML_SCRIPT_TIME_LIMIT', 'HTML_SCRIPT_MEMORY_LIMIT'].includes(code)) this.exhausted = true;
        this.issue(code);
    }
    private budgetCode(): string {return performance.now() > this.deadline ? 'HTML_SCRIPT_TIME_LIMIT' : 'HTML_SCRIPT_FAILED';}
    private execute(action: () => void): void {
        if (this.destroyed || !this.runtime) return;
        this.running = true; this.deadline = performance.now() + 100; this.dom.resetBudget();
        try {
            action();
            const pending = this.runtime.executePendingJobs(100);
            if (pending.error) this.failure(pending.error);
            else if (this.runtime.hasPendingJob()) {this.issue('HTML_PROMISE_JOB_LIMIT'); this.exhausted = true;}
        } catch {this.issue(this.budgetCode());}
        finally {this.running = false; if (this.exhausted) this.destroy();}
    }
    destroy(): void {
        if (this.destroyed) return; this.destroyed = true;
        for (const timer of this.timers.values()) clearTimeout(timer); this.timers.clear();
        this.dom.destroy(); this.callbacks.clear(); this.handles.forEach(handle => handle.dispose()); this.handles = [];
        this.context?.dispose(); this.runtime?.dispose(); this.context = undefined; this.runtime = undefined;
    }
}
