import type {StudyEntry, StudyHost} from './contracts';
import type {StudyText} from './locale';
import {element} from './dom';
import {randomUUID} from '../utils/random';
import {studyFailure} from './operations';
interface Choice {entry?: StudyEntry; label: string}
/** Directory IDs stay opaque. Searchable labels are assembled from the enumerated hierarchy. */
export class StudyDestination {
    readonly element = element('div', 'mdx-study-destination');
    private input = element('input');
    private options = element('div', 'mdx-study-destination__options');
    private notice = element('p', 'mdx-study__hint');
    private choices: Choice[];
    private matches: Choice[] = [];
    private selected?: StudyEntry;
    private resolved = true;
    private active = -1;
    private loading?: Promise<void>;
    private loaded = false;
    private suppressFocus = false;
    private query = '';
    constructor(private host: StudyHost, private w: StudyText, private signal: AbortSignal, parent?: StudyEntry) {
        this.selected = parent; this.choices = [{label: w('rootDestination')}, ...(parent ? [{entry: parent, label: parent.title}] : [])];
        const id = 'study-directory-' + randomUUID(); this.options.id = id; this.options.setAttribute('role', 'listbox'); this.options.hidden = true;
        this.input.type = 'search'; this.input.autocomplete = 'off'; this.input.value = parent?.title ?? w('rootDestination');
        this.input.setAttribute('role', 'combobox'); this.input.setAttribute('aria-autocomplete', 'list');
        this.input.setAttribute('aria-controls', id); this.input.setAttribute('aria-label', w('destination')); this.input.setAttribute('aria-expanded', 'false');
        this.input.placeholder = w('searchDirectories'); this.notice.setAttribute('role', 'status');
        this.element.append(element('span', 'mdx-study-destination__label', w('destination')), this.input, this.options, this.notice);
        this.input.onfocus = () => {if (!this.suppressFocus) {this.query = ''; void this.open();}};
        this.input.oninput = () => {this.resolved = false; this.query = this.input.value; this.active = -1; void this.open();};
        this.input.onkeydown = event => this.keydown(event);
        document.addEventListener('pointerdown', event => {if (!this.element.contains(event.target as Node)) this.close();}, {signal});
    }
    valid(): boolean {return this.resolved;}
    capture(): StudyEntry | undefined {return this.selected;}
    restore(parent?: StudyEntry): void {this.selected = parent; this.resolved = true; this.input.value = parent?.title ?? this.w('rootDestination');}
    value(): StudyEntry | undefined {
        if (!this.resolved) {this.notice.textContent = this.w('chooseDirectory'); this.input.focus(); throw Object.assign(new Error(this.w('chooseDirectory')), {code: 'DIRECTORY_NOT_SELECTED'});}
        return this.selected;
    }
    private close(): void {this.options.hidden = true; this.input.setAttribute('aria-expanded', 'false'); this.input.removeAttribute('aria-activedescendant');}
    private async open(): Promise<void> {
        this.render(); if (this.loaded) return;
        this.loading ??= this.load().finally(() => {this.loading = undefined;}); await this.loading;
    }
    private async load(): Promise<void> {
        const operationId = randomUUID(), started = Date.now(); this.notice.textContent = this.w('loadingDirectories');
        try {
            const pending = (await this.directories()).map(entry => ({entry, label: entry.title}));
            const choices: Choice[] = [{label: this.w('rootDestination')}], visited = new Set<string>();
            this.choices = [...choices, ...pending]; if (!this.options.hidden) this.render();
            while (pending.length && !this.signal.aborted) {
                const choice = pending.shift()!; if (visited.has(choice.entry.id)) continue; visited.add(choice.entry.id); choices.push(choice);
                for (const child of await this.directories(choice.entry.id)) pending.push({entry: child, label: choice.label + ' / ' + child.title});
            }
            if (this.signal.aborted) return;
            this.choices = choices; this.loaded = true; this.notice.textContent = '';
            if (this.resolved && this.selected) this.input.value = choices.find(choice => choice.entry?.id === this.selected!.id)?.label ?? this.selected.title;
            if (!this.options.hidden) this.render();
            console.debug('[StudyDestination]', {operationId, stage: 'list-directories', result: 'success', count: choices.length, durationMs: Date.now() - started});
        } catch (error) {
            if (this.signal.aborted) return;
            const {code} = studyFailure(error); this.notice.textContent = `${this.w('failed')} (${code})`;
            console.warn('[StudyDestination]', {operationId, stage: 'list-directories', result: 'failure', code, durationMs: Date.now() - started});
        }
    }
    private async directories(parent?: string): Promise<StudyEntry[]> {
        const source = this.host.creation?.documents.directories;
        const entries = source ? await source.list(parent, this.signal) : await this.host.list(parent);
        return entries.filter(entry => entry.kind === 'directory');
    }
    private render(): void {
        const normalize = (text: string) => text.toLocaleLowerCase().replace(/\s*\/\s*/g, '/');
        const words = normalize(this.query).trim().split(/\s+/).filter(Boolean);
        this.matches = this.choices.filter(choice => words.every(word => normalize(choice.label).includes(word)));
        this.options.replaceChildren(); this.options.hidden = false; this.input.setAttribute('aria-expanded', 'true');
        this.matches.forEach((choice, index) => {
            const option = element('button', 'mdx-study-destination__option', choice.label); option.type = 'button'; option.tabIndex = -1;
            option.id = this.options.id + '-' + index; option.setAttribute('role', 'option'); option.setAttribute('aria-selected', String(index === this.active));
            option.onmousedown = event => event.preventDefault(); option.onclick = () => this.choose(choice); this.options.append(option);
        });
        if (!this.matches.length) this.options.append(element('p', 'mdx-study__hint', this.w('noDirectories')));
        if (this.active >= 0 && this.active < this.matches.length) this.input.setAttribute('aria-activedescendant', this.options.id + '-' + this.active);
        else this.input.removeAttribute('aria-activedescendant');
    }
    private choose(choice: Choice): void {
        this.selected = choice.entry; this.resolved = true; this.input.value = choice.label; this.notice.textContent = ''; this.close(); this.input.dispatchEvent(new Event('change', {bubbles: true}));
        this.suppressFocus = true; this.input.focus(); this.suppressFocus = false;
    }
    private keydown(event: KeyboardEvent): void {
        if (event.key === 'Escape' && !this.options.hidden) {event.preventDefault(); event.stopPropagation(); this.close(); return;}
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); const step = event.key === 'ArrowDown' ? 1 : -1;
            this.active = Math.max(0, Math.min(this.matches.length - 1, this.active + step)); void this.open(); return;
        }
        if (event.key === 'Enter' && !this.options.hidden) {
            event.preventDefault();
            const choice = this.active >= 0 ? this.matches[this.active] : this.resolved
                ? this.matches.find(value => value.entry?.id === this.selected?.id) : this.matches.length === 1 ? this.matches[0] : undefined;
            if (choice) this.choose(choice); else this.notice.textContent = this.w('chooseDirectory');
        }
    }
}
