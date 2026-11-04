import {element, studyButton} from './dom';
import {randomUUID} from '../utils/random';
import type {StudyText} from './locale';
/** Explicit expansion shows every template, regardless of the current editable name. */
export class StudyPromptPicker {
    readonly element = element('div', 'mdx-study-prompts__picker');
    readonly input = element('input');
    private list = element('ul', 'mdx-study-prompts__options');
    private toggle: HTMLButtonElement;
    private names: string[] = [];
    private active = -1;
    constructor(w: StudyText, private select: (name: string) => void) {
        this.list.id = 'study-prompts-' + randomUUID(); this.list.role = 'listbox'; this.list.hidden = true;
        this.list.setAttribute('aria-label', w('choosePrompt'));
        this.input.setAttribute('role', 'combobox'); this.input.setAttribute('aria-controls', this.list.id);
        this.input.setAttribute('aria-expanded', 'false'); this.input.setAttribute('aria-autocomplete', 'list');
        this.input.setAttribute('aria-label', w('promptName')); this.input.autocomplete = 'off';
        this.input.placeholder = w('promptName'); this.input.maxLength = 100;
        this.toggle = studyButton(w('choosePrompt'), () => {this.show(this.list.hidden); this.input.focus();}, 'quiet');
        this.toggle.classList.add('mdx-study-prompts__toggle'); this.toggle.textContent = '';
        this.toggle.setAttribute('aria-label', w('choosePrompt')); this.toggle.setAttribute('aria-controls', this.list.id);
        this.toggle.setAttribute('aria-expanded', 'false');
        this.input.addEventListener('click', () => this.show(true));
        this.input.addEventListener('input', () => {this.show(true); this.render(this.input.value);});
        this.input.addEventListener('keydown', event => this.key(event));
        this.list.onpointerdown = event => event.preventDefault();
        this.element.addEventListener('focusout', event => {if (!this.element.contains(event.relatedTarget as Node | null)) this.show(false);});
        this.element.append(this.input, this.toggle, this.list);
    }
    update(names: string[]): void {this.names = names; this.render();}
    private show(open: boolean): void {
        this.list.hidden = !open; this.input.setAttribute('aria-expanded', String(open)); this.toggle.setAttribute('aria-expanded', String(open));
        this.active = -1; this.input.removeAttribute('aria-activedescendant'); if (open) this.render();
    }
    private render(filter = ''): void {
        this.active = -1; this.input.removeAttribute('aria-activedescendant');
        this.list.replaceChildren(...this.names.filter(name => name.toLocaleLowerCase().includes(filter.toLocaleLowerCase())).map((name, index) => {
            const option = element('li', 'mdx-study-prompts__option', name); option.role = 'option';
            option.id = `${this.list.id}-${index}`; option.setAttribute('aria-selected', String(name === this.input.value));
            option.onclick = () => {if (!this.input.disabled) this.choose(name);}; return option;
        }));
    }
    private choose(name: string): void {this.input.value = name; this.select(name); this.show(false); this.input.focus();}
    private key(event: KeyboardEvent): void {
        if (event.key === 'Escape' && !this.list.hidden) {event.preventDefault(); event.stopPropagation(); this.show(false); return;}
        if (event.key === 'Enter' && !this.list.hidden && this.active >= 0) {
            event.preventDefault(); this.choose(this.list.children[this.active].textContent!); return;
        }
        if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
        event.preventDefault(); if (this.list.hidden) this.show(true);
        const options = [...this.list.children] as HTMLElement[]; if (!options.length) return;
        this.active = this.active < 0 ? (event.key === 'ArrowDown' ? 0 : options.length - 1)
            : (this.active + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length;
        options.forEach((option, index) => option.classList.toggle('mdx-study-prompts__option--active', index === this.active));
        this.input.setAttribute('aria-activedescendant', options[this.active].id); options[this.active].scrollIntoView?.({block: 'nearest'});
    }
}
