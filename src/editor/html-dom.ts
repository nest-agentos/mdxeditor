import {allowedAttribute, allowedTag, prepareHtmlDocument, PREVIEW_ID, type HtmlHandler} from './html-policy';

export type HtmlIssue = (code: string) => void;
export interface HtmlEvent {callback: number; node: number; event: Record<string, unknown>;}
function isElement(node: Node): node is HTMLElement {return node.nodeType === 1;}
const read = new Set('nodeName tagName nodeType textContent innerHTML value checked disabled selectedIndex id className isConnected'.split(' '));
const write = new Set('textContent value checked disabled selectedIndex id className'.split(' '));
const childCommands = new Set('appendChild append prepend replaceChildren insertBefore'.split(' '));
const relatives = new Set('body head documentElement parentNode parentElement firstChild lastChild nextSibling previousSibling'.split(' '));

/** The only native DOM authority is this document. Only JSON primitives and local node IDs leave it. */
export class HtmlDom {
    private nodes = new Map<number, Node>();
    private ids = new WeakMap<Node, number>();
    private next = 0;
    private operations = 0;
    private listeners = 0;
    private lifetime = new AbortController();
    onEvent: (event: HtmlEvent) => number | void = () => {};
    onHandlers: (handlers: HtmlHandler[]) => void = () => {};
    constructor(private document: Document, private issue: HtmlIssue) {
        this.nodes.set(0, document); this.ids.set(document, 0);
        for (const element of document.querySelectorAll(`[${PREVIEW_ID}]`)) {
            const id = Number(element.getAttribute(PREVIEW_ID)); this.next = Math.max(this.next, id);
            this.nodes.set(id, element); this.ids.set(element, id);
        }
        document.addEventListener('securitypolicyviolation', () => this.issue('HTML_RESOURCE_BLOCKED'), {signal: this.lifetime.signal});
        document.addEventListener('submit', event => {event.preventDefault(); this.issue('HTML_FORM_BLOCKED');}, {signal: this.lifetime.signal, capture: true});
    }
    resetBudget(): void {this.operations = 0;}
    destroy(): void {this.lifetime.abort(); this.nodes.clear(); this.onEvent = () => {}; this.onHandlers = () => {};}
    id(node: Node | null): number | null {
        if (!node) return null;
        if (node !== this.document && node.ownerDocument !== this.document) throw new Error('HTML_NODE_OUTSIDE_DOCUMENT');
        const known = this.ids.get(node); if (known !== undefined) return known;
        if (++this.next > 20_000) throw new Error('HTML_NODE_LIMIT');
        this.nodes.set(this.next, node); this.ids.set(node, this.next); return this.next;
    }
    request(encoded: string): string {
        try {
            if (++this.operations > 10_000 || encoded.length > 128_000) throw new Error('HTML_DOM_BUDGET_EXCEEDED');
            const [op, id, name, args] = JSON.parse(encoded);
            if (typeof name !== 'string' || !Array.isArray(args)) throw new Error('HTML_DOM_REQUEST_INVALID');
            const node = this.nodes.get(id); if (!node) throw new Error('HTML_NODE_INVALID');
            return JSON.stringify({value: this.dispatch(op, node, name, args)});
        } catch (error) {
            const code = error instanceof Error && /^HTML_[A-Z_]+$/.test(error.message) ? error.message : 'HTML_DOM_OPERATION_FAILED';
            this.issue(code); return JSON.stringify({error: code});
        }
    }
    private reference(node: Node | null): unknown {return node ? {node: this.id(node)} : null;}
    private dispatch(op: string, node: Node, name: string, args: unknown[]): unknown {
        if (op === 'get') return this.get(node, name);
        if (op === 'set') return this.set(node, name, args[0]);
        if (op === 'listen') return this.listen(node, name, Number(args[0]));
        if (op === 'call') return this.call(node, name, args);
        throw new Error('HTML_DOM_API_UNSUPPORTED');
    }
    private get(node: Node, name: string): unknown {
        if (read.has(name)) return this.value(node, name);
        if (relatives.has(name)) return this.reference((node as unknown as Record<string, Node | null>)[name] ?? null);
        if (name === 'children' || name === 'childNodes') return Array.from(node.childNodes).filter(child => name !== 'children' || child.nodeType === 1).map(child => this.reference(child));
        if (name.startsWith('style:') && isElement(node)) return (node as HTMLElement).style.getPropertyValue(name.slice(6));
        throw new Error('HTML_DOM_API_UNSUPPORTED');
    }
    private value(node: Node, name: string): unknown {
        const value = (node as unknown as Record<string, unknown>)[name] ?? null;
        if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) throw new Error('HTML_DOM_VALUE_UNSUPPORTED');
        return value;
    }
    private set(node: Node, name: string, value: unknown): null {
        if (!(isElement(node)) && node.nodeType !== 3) throw new Error('HTML_DOM_API_UNSUPPORTED');
        if (write.has(name)) (node as unknown as Record<string, unknown>)[name] = value;
        else if (name === 'innerHTML' && isElement(node)) this.insert(node, String(value), false);
        else if (name.startsWith('style:') && isElement(node)) (node as HTMLElement).style.setProperty(name.slice(6), String(value));
        else throw new Error('HTML_DOM_API_UNSUPPORTED');
        return null;
    }
    private target(value: unknown): Node {
        const id = (value as {node?: number})?.node, node = id === undefined ? undefined : this.nodes.get(id);
        if (!node) throw new Error('HTML_NODE_INVALID'); return node;
    }
    private query(node: Node, name: string, argument: unknown): unknown {
        if (!('querySelector' in node) || String(argument).length > 1024) throw new Error('HTML_SELECTOR_INVALID');
        const selector = name === 'getElementById' ? `[id=${JSON.stringify(String(argument))}]` : String(argument);
        const parent = node as ParentNode;
        return name === 'querySelectorAll' ? Array.from(parent.querySelectorAll(selector)).map(child => this.reference(child)) : this.reference(parent.querySelector(selector));
    }
    private call(node: Node, name: string, args: unknown[]): unknown {
        if (['querySelector', 'querySelectorAll', 'getElementById'].includes(name)) return this.query(node, name, args[0]);
        if (node === this.document && ['createElement', 'createTextNode'].includes(name)) return this.create(name, args);
        if (name === 'remove') {node.parentNode?.removeChild(node); return null;}
        if (!(isElement(node))) throw new Error('HTML_DOM_API_UNSUPPORTED');
        if (childCommands.has(name)) return this.children(node, name, args);
        if (name.startsWith('class:')) return this.classes(node, name.slice(6), args);
        return this.elementCall(node, name, args);
    }
    private create(name: string, args: unknown[]): unknown {
        if (name === 'createTextNode') return this.reference(this.document.createTextNode(String(args[0])));
        const tag = String(args[0]); if (!allowedTag(tag)) throw new Error('HTML_ELEMENT_BLOCKED');
        return this.reference(this.document.createElement(tag));
    }
    private children(node: Element, name: string, args: unknown[]): unknown {
        if (name === 'appendChild') return this.reference(node.appendChild(this.target(args[0])));
        if (name === 'append' || name === 'prepend' || name === 'replaceChildren') {
            node[name](...args.map(value => typeof value === 'object' && value !== null ? this.target(value) : String(value))); return null;
        }
        if (name === 'insertBefore') return this.reference(node.insertBefore(this.target(args[0]), args[1] === null ? null : this.target(args[1])));
        throw new Error('HTML_DOM_API_UNSUPPORTED');
    }
    private elementCall(node: Element, name: string, args: unknown[]): unknown {
        if (name === 'getAttribute') return node.getAttribute(String(args[0]));
        if (name === 'setAttribute') {
            const key = String(args[0]).toLowerCase(), value = String(args[1]);
            if (!allowedAttribute(key, value, node.localName)) throw new Error('HTML_ATTRIBUTE_BLOCKED');
            node.setAttribute(key, value); return null;
        }
        if (name === 'removeAttribute' && args[0] !== PREVIEW_ID) {node.removeAttribute(String(args[0])); return null;}
        if (name === 'insertAdjacentHTML' && args[0] === 'beforeend') {this.insert(node, String(args[1]), true); return null;}
        if (name === 'focus' && isElement(node)) {node.focus(); return null;}
        throw new Error('HTML_DOM_API_UNSUPPORTED');
    }
    private classes(node: Element, name: string, args: unknown[]): unknown {
        if (name === 'contains') return node.classList.contains(String(args[0]));
        if (name === 'toggle') return args.length > 1 ? node.classList.toggle(String(args[0]), Boolean(args[1])) : node.classList.toggle(String(args[0]));
        if (name === 'add' || name === 'remove') {node.classList[name](...args.map(String)); return null;}
        throw new Error('HTML_DOM_API_UNSUPPORTED');
    }
    private insert(node: Element, source: string, append: boolean): void {
        const filtered = prepareHtmlDocument(source, true);
        const template = this.document.createElement('template'); template.innerHTML = filtered.html;
        const fragment = this.document.adoptNode(template.content);
        const handlers: HtmlHandler[] = [];
        for (const element of fragment.querySelectorAll(`[${PREVIEW_ID}]`)) {
            const previous = Number(element.getAttribute(PREVIEW_ID)), id = this.id(element)!;
            element.setAttribute(PREVIEW_ID, String(id));
            handlers.push(...filtered.handlers.filter(handler => handler.id === previous).map(handler => ({...handler, id})));
        }
        if (append) node.append(fragment); else node.replaceChildren(fragment);
        if (filtered.blocked || filtered.scripts.length) this.issue('HTML_DYNAMIC_SCRIPT_BLOCKED');
        if (handlers.length) this.onHandlers(handlers);
    }
    private listen(node: Node, name: string, callback: number): null {
        if (++this.listeners > 1000) throw new Error('HTML_LISTENER_LIMIT');
        if (!/^[a-zA-Z]{1,30}$/.test(name) || !Number.isSafeInteger(callback)) throw new Error('HTML_EVENT_INVALID');
        node.addEventListener(name, event => {
            const native = event as KeyboardEvent & MouseEvent;
            const flags = this.onEvent({callback, node: this.id(node)!, event: {type: event.type, target: this.id(event.target as Node),
                key: native.key, code: native.code, button: native.button, clientX: native.clientX, clientY: native.clientY,
                altKey: native.altKey, ctrlKey: native.ctrlKey, shiftKey: native.shiftKey, metaKey: native.metaKey}}) ?? 0;
            if (flags & 1) event.preventDefault();
            if (flags & 2) event.stopPropagation();
            if (flags & 4) event.stopImmediatePropagation();
        }, {signal: this.lifetime.signal}); return null;
    }
}
