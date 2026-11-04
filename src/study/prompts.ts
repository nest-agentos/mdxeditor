import type {StudyPromptOptions, StudyPrompt} from './contracts';
import type {StudyText} from './locale';
import {StudyPromptPicker} from './prompt-picker';
import {element, studyButton} from './dom';
import {randomUUID} from '../utils/random';
/** Named templates are host supplied; edited text stays local until explicitly saved. */
export class StudyPrompts {
    readonly element = element('div', 'mdx-study-prompts');
    private picker: StudyPromptPicker;
    private name: HTMLInputElement;
    private items: StudyPrompt[];
    private drafts = new Map<string, {name: string; content: string}>();
    private current = '';
    private touched = false;
    private loaded = false;
    constructor(private creation: StudyPromptOptions, private prompt: HTMLTextAreaElement, private w: StudyText,
        perform: (action: () => Promise<void>) => Promise<void>) {
        this.items = [...(creation.presets ?? [])];
        this.picker = new StudyPromptPicker(w, () => this.name.dispatchEvent(new Event('change')));
        this.name = this.picker.input;
        this.name.onchange = () => {
            this.touched = true; const selected = this.items.find(item => item.name === this.name.value.trim());
            if (selected && selected.id !== this.current) {this.remember(); this.choose(selected.id);}
        };
        this.name.oninput = this.prompt.oninput = () => {this.touched = true;};
        const save = studyButton(w('savePrompt'), () => {void perform(() => this.save());}, 'quiet');
        this.element.append(this.picker.element, save, element('span', 'mdx-study__hint', w('promptNameHint')));
        this.render(); if (this.items.length) this.choose(this.items[0].id);
    }
    async load(signal: AbortSignal): Promise<void> {
        const saved = await this.creation.store!.list?.(signal);
        const legacy = saved === undefined ? await this.creation.store!.load(signal) : undefined;
        if (signal.aborted) return;
        this.loaded = true;
        if (saved) this.items = [...saved, ...this.items.filter(item => !saved.some(value => value.id === item.id))];
        else if (legacy !== undefined) this.items.unshift({id: 'legacy', name: this.w('savedPrompt'), content: legacy});
        if (this.touched) {this.remember(); this.render(); return;}
        this.render(); if (this.items.length) this.choose(this.items[0].id);
    }
    selectedName(): string {return this.name.value.trim();}
    restore(name: string, content: string): void {this.touched = true; this.name.value = name; this.prompt.value = content;}
    private remember(): void {this.drafts.set(this.current, {name: this.items.find(item => item.id === this.current)?.name ?? this.name.value, content: this.prompt.value});}
    private choose(id: string): void {
        this.current = id;
        const item = this.drafts.get(id) ?? this.items.find(item => item.id === id);
        this.name.value = item?.name ?? ''; this.prompt.value = item?.content ?? '';
    }
    private render(): void {
        this.picker.update(this.items.map(item => item.name));
    }
    private async save(): Promise<void> {
        if (!this.loaded) throw Object.assign(new Error('Prompt list has not loaded'), {code: 'PROMPTS_NOT_LOADED'});
        const name = this.name.value.trim();
        if (!name) {this.name.focus(); throw Object.assign(new Error(this.w('promptNameRequired')), {code: 'PROMPT_NAME_REQUIRED'});}
        const item = {id: this.items.find(value => value.name === name)?.id ?? randomUUID(), name, content: this.prompt.value};
        const next = this.items.filter(value => value.id !== item.id); next.push(item);
        await this.creation.store!.saveList!(next);
        this.items = next; this.drafts.delete(item.id); this.current = item.id; this.touched = true;
        this.render(); this.choose(item.id);
    }
}
