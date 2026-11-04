import {MDxRenderer} from '../renderer/mdx-renderer';
import {ClozePlugin} from '../plugins/cloze/cloze.plugin';
import {element, studyButton} from './dom';
import type {StudyText} from './locale';
import {studyFailure} from './operations';
import {randomUUID} from '../utils/random';
/** Preview has no persistence or SRS plugin: inspecting a draft never records progress. */
export class StudyDraftPreview {
    readonly controls = element('div', 'mdx-study-create__preview-controls');
    readonly output = element('div', 'mdx-study-create__preview');
    private renderer: MDxRenderer;
    private editing = true;
    private edit: HTMLButtonElement;
    private render: HTMLButtonElement;
    constructor(private source: HTMLTextAreaElement, private w: StudyText, private signal: AbortSignal) {
        this.renderer = new MDxRenderer({htmlPolicy: 'literal', signal}).usePlugin(new ClozePlugin());
        this.edit = studyButton(w('editResult'), () => {void this.show(true);}, 'quiet');
        this.render = studyButton(w('previewResult'), () => {void this.show(false);}, 'quiet');
        this.controls.append(this.edit, this.render); this.output.hidden = true; this.updateButtons();
        signal.addEventListener('abort', () => this.renderer.destroy(), {once:true});
    }
    reset(): void {this.output.replaceChildren(); void this.show(true);}
    async refresh(): Promise<void> {if (!this.editing) await this.show(false);}
    private updateButtons(): void {this.edit.setAttribute('aria-pressed', String(this.editing)); this.render.setAttribute('aria-pressed', String(!this.editing));}
    private async show(editing: boolean): Promise<void> {
        if (this.signal.aborted) return;
        this.editing = editing; this.updateButtons(); this.source.parentElement!.hidden = !editing; this.output.hidden = editing;
        if (editing) {this.renderer.cancelPending(); this.source.focus(); return;}
        const operationId = randomUUID(), started = Date.now();
        try {
            await this.renderer.render(this.output, this.source.value);
            console.debug('[StudyDraftPreview]', {operationId, stage:'render-draft', result:'success', durationMs:Date.now()-started});
        } catch (error) {
            if (this.signal.aborted || (error as Error)?.name === 'AbortError') return;
            const {code} = studyFailure(error); this.output.textContent = this.w('previewFailed');
            console.warn('[StudyDraftPreview]', {operationId, stage:'render-draft', result:'failure', code, durationMs:Date.now()-started});
        }
    }
}
