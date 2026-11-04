import {element, studyButton} from './dom';
import type {StudyText} from './locale';
import {randomUUID} from '../utils/random';
type Tab = 'source' | 'prompt' | 'result';
/** Keep panels mounted so switching never discards source, instructions or generated work. */
export class StudyCreationTabs {
    readonly element = element('div', 'mdx-study-create__tabs');
    readonly source = element('div', 'mdx-study-create__tab-panel');
    readonly prompt = element('div', 'mdx-study-create__tab-panel');
    readonly result = element('div', 'mdx-study-create__tab-panel');
    private buttons = new Map<Tab, HTMLButtonElement>();
    private current: Tab = 'source';
    value(): Tab {return this.current;}
    constructor(w: StudyText) {
        const list = element('div', 'mdx-study-create__tab-list'), id = randomUUID(); list.setAttribute('role', 'tablist');
        const entries: Array<[Tab, string]> = [['source','referenceContent'], ['prompt','promptTab'], ['result','resultTitle']];
        entries.forEach(([key, label], index) => {
            const button = studyButton(w(label), () => this.show(key), 'quiet'), panel = this[key];
            button.id = id + '-' + key; button.setAttribute('role','tab'); button.setAttribute('aria-controls', button.id + '-panel');
            panel.id = button.id + '-panel'; panel.setAttribute('role','tabpanel'); panel.setAttribute('aria-labelledby', button.id);
            button.onkeydown = event => {
                const next = event.key === 'ArrowRight' ? (index + 1) % 3 : event.key === 'ArrowLeft' ? (index + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : -1;
                if (next < 0) return; event.preventDefault(); this.show(entries[next][0]); this.buttons.get(entries[next][0])!.focus();
            };
            this.buttons.set(key,button); list.append(button);
        });
        this.element.append(list, this.prompt, this.source, this.result); this.show('source');
    }
    show(tab: Tab): void {
        this.current = tab;
        for (const [key, button] of this.buttons) {const active = key === tab; button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1; this[key].hidden = !active;}
    }
}
