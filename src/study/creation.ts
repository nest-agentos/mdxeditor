import type {StudyCreation, StudyCreationState, StudyEntry, StudyHost} from './contracts';
import {CreationState} from './creation-state';
import {CreationRecovery} from './creation-recovery';
import {element, studyButton} from './dom';
import type {StudyText} from './locale';
import {studyFailure} from './operations';
import {randomUUID} from '../utils/random';
import {StudyDestination} from './destination';
import {studySyntaxHelp} from './syntax-help';
import {StudyPrompts} from './prompts';
import {StudyGenerationTargets} from './generation-targets';
import {StudyDraftPreview} from './draft-preview';
import {StudySourceSearch} from './source-search';
import {StudyCreationTabs} from './creation-tabs';

type FormControl = HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement | HTMLSelectElement;

/** Draft-only UI; model execution, templates and storage belong to the host. */
export function createStudyDocument(container: HTMLElement, host: StudyHost, w: StudyText, signal: AbortSignal, parent?: StudyEntry, restored?: StudyCreationState): Promise<void> {
    const creation = host.creation; if (!creation || signal.aborted) return Promise.resolve();
    return new Promise(resolve => {new CreationDialog(container, host, creation, w, signal, resolve, parent, restored);});
}
class CreationDialog {
    private dialog = element('dialog', 'mdx-study-create');
    private form = element('form');
    private title = element('input');
    private content = element('textarea');
    private prompt = element('textarea');
    private source = element('textarea');
    private status = element('p', 'mdx-study__status');
    private execution = element('p', 'mdx-study__hint');
    private recoveryNotice = element('p', 'mdx-study__hint');
    private recovery?: CreationRecovery;
    private leaving = false;
    private executionState?: {label: string; url: string};
    private fields = element('details', 'mdx-study-create__draft');
    private replace = element('input');
    private replaceLabel: HTMLLabelElement;
    private closeButton: HTMLButtonElement;
    private save?: HTMLButtonElement;
    private generate?: HTMLButtonElement;
    private controller = new AbortController();
    private state = new CreationState(randomUUID);
    private busy = false;
    private saving = false;
    private closed = false;
    private destination: StudyDestination;
    private prompts?: StudyPrompts;
    private targets?: StudyGenerationTargets;
    private preview: StudyDraftPreview;
    private tabs: StudyCreationTabs;
    constructor(container: HTMLElement, host: StudyHost, private creation: StudyCreation, private w: StudyText,
        private signal: AbortSignal, private done: () => void, parent?: StudyEntry, restored?: StudyCreationState) {
        this.tabs = new StudyCreationTabs(w); this.form.append(this.tabs.element); this.form.noValidate = true;
        this.title.required = true; this.title.maxLength = 240; this.source.autofocus = !!creation.generation;
        this.prompt.value = creation.prompts?.defaultPrompt ?? ''; this.content.rows = 14; this.prompt.rows = 14; this.source.rows = 12;
        this.status.setAttribute('role', 'status'); this.replace.type = 'checkbox';
        this.replaceLabel = field(w('replaceDraft'), this.replace); this.replaceLabel.hidden = true;
        this.closeButton = studyButton(w('close'), () => {void this.close();}, 'quiet');
        this.fields.open = true; this.content.oninput = () => {this.fields.open = true;};
        this.preview = new StudyDraftPreview(this.content, w, this.controller.signal);
        this.fields.append(element('summary', '', w('resultTitle')), this.preview.controls, field(w('draftContent'), this.content), this.preview.output);
        this.destination = new StudyDestination(host, w, this.controller.signal, parent);
        const location = element('div', 'mdx-study-create__location');
        const separator = element('span', 'mdx-study-create__path-separator', '/'); separator.setAttribute('aria-hidden', 'true');
        location.append(this.destination.element, separator, field(w('documentName'), this.title)); this.tabs.result.append(location);
        this.inputs(host); this.actions();
        const changed = () => {if (!this.busy) {this.status.textContent = ''; delete this.status.dataset.state;} this.updateActions();};
        this.form.addEventListener('input', changed); this.form.addEventListener('change', changed); this.updateActions();
        this.dialog.append(element('h3', '', creation.label ?? w('newDocument')), this.form);
        this.dialog.setAttribute('aria-label', creation.label ?? w('newDocument'));
        this.dialog.oncancel = event => {if (event.target !== this.dialog) return; event.preventDefault(); if (!this.saving) this.close();};
        this.dialog.addEventListener('close', () => {if (!this.closed) void this.close();});
        signal.addEventListener('abort', this.abort, {once: true}); container.append(this.dialog); this.dialog.showModal();
        this.installRecovery();
        if (restored) this.restore(restored);
        if (!restored || this.prompts) void this.loadPrompt();
        if (restored?.pendingOperationId && creation.generation?.resume) void this.resumePending();
    }
    private installRecovery(): void {
        if (this.creation.recovery) this.recovery = new CreationRecovery(this.creation.recovery, ok => {this.recoveryNotice.textContent = this.w(ok ? 'draftCheckpointed' : 'draftCheckpointFailed');});
        const changed = () => {if (!this.saving) {this.state.touched = true; this.checkpoint();}};
        this.form.append(this.recoveryNotice); this.form.addEventListener('input', changed); this.form.addEventListener('change', changed);
        this.tabs.element.addEventListener('click', () => this.checkpoint());
        window.addEventListener('pagehide', () => {this.leaving = true; this.checkpoint();}, {capture: true, signal: this.controller.signal});
        window.addEventListener('pageshow', () => {this.leaving = false;}, {signal: this.controller.signal});
    }
    private abort = () => {void this.close(!this.leaving);};
    private async close(discard = true): Promise<void> {
        if (this.closed) return; if (!discard) this.checkpoint(); this.closed = true;
        if (discard) this.cancelGeneration();
        this.controller.abort();
        this.signal.removeEventListener('abort', this.abort); this.dialog.close(); this.dialog.remove();
        try {if (discard) await this.recovery?.clear(true); else await this.recovery?.flush();} finally {this.done();}
    }
    private cancelGeneration(): void {
        const operationId = this.state.pendingOperation, generation = this.creation.generation, started = Date.now();
        if (!operationId || !generation?.cancel) return;
        void Promise.resolve().then(() => generation.cancel!({draftId: this.state.draftId, operationId})).then(() => {
            console.debug('[StudyCreation]', {operationId, operation: 'study.create', stage: 'cancel-generation', result: 'success', durationMs: Date.now() - started});
        }).catch(error => {
            console.warn('[StudyCreation]', {operationId, operation: 'study.create', stage: 'cancel-generation', result: 'failure', code: studyFailure(error).code, durationMs: Date.now() - started});
        });
    }
    private checkpoint(): void {
        if (this.closed || !this.state.touched && !this.state.pendingOperation) return;
        this.recovery?.save({version: 1, draftId: this.state.draftId, title: this.title.value, source: this.source.value, prompt: this.prompt.value,
            content: this.content.value, generated: this.state.generated, parent: this.destination.capture(), promptName: this.prompts?.selectedName(),
            ...this.targets?.capture(), tab: this.tabs.value(), pendingOperationId: this.state.pendingOperation, execution: this.executionState});
    }
    private restore(state: StudyCreationState): void {
        this.state.restore(state);
        this.title.value = state.title; this.source.value = state.source; this.prompt.value = state.prompt;
        this.content.value = state.content;
        this.prompts?.restore(state.promptName ?? '', state.prompt); this.targets?.restore(state.targetId, state.modelId); this.destination.restore(state.parent);
        this.tabs.show(state.tab ?? (state.content ? 'result' : 'source')); if (state.execution) this.showExecution(state.execution);
        this.recoveryNotice.textContent = this.w('draftRestored'); this.updateActions();
    }
    private showExecution(execution: {label: string; url: string}): void {
        if (this.closed) return; this.executionState = execution;
        const link = element('a', '', execution.label); link.href = execution.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; this.execution.replaceChildren(link); this.checkpoint();
    }
    private async resumePending(): Promise<void> {
        const operationId = this.state.pendingOperation!; this.state.begin(operationId);
        await this.perform('resume-generation', async () => {
            const result = await this.creation.generation!.resume!({draftId: this.state.draftId, operationId, signal: this.controller.signal, onExecution: value => this.showExecution(value)});
            this.acceptGenerated(result);
        });
    }
    private acceptGenerated(result: string): void {
        if (this.controller.signal.aborted) return;
        if (!result.trim()) throw Object.assign(new Error('Empty draft'), {code: 'EMPTY_GENERATED_DRAFT'});
        this.state.complete(result); this.content.value = result; this.fields.open = true; this.tabs.show('result');
        this.replace.checked = false; this.replaceLabel.hidden = true; if (this.generate) this.generate.textContent = this.w('regenerateDraft');
        this.checkpoint(); void this.preview.refresh().catch(() => {this.recoveryNotice.textContent = this.w('previewFailed');});
    }
    private inputs(host: StudyHost): void {
        const imports = sourceControls(host, this.creation.generation ? this.source : this.content,
            (stage, action) => this.perform(stage, action), this.controller.signal, this.w);
        if (this.creation.generation) {
            this.generate = studyButton(this.w('generateDraft'), () => this.generateDraft(), 'primary');
            const source = element('fieldset', 'mdx-study-create__source');
            this.source.setAttribute('aria-label', this.w('referenceContent')); this.source.placeholder = this.w('sourcePlaceholder');
            source.append(element('legend', '', this.w('referenceContent')), imports, this.source, element('p', 'mdx-study__hint', this.w('sourceHelp')));
            this.tabs.prompt.append(field(this.w('generationPrompt'), this.prompt)); this.tabs.source.append(source);
            if (this.creation.generation?.targets) {
                this.targets = new StudyGenerationTargets(this.creation.generation?.targets, this.w, this.controller.signal, () => this.updateActions()); this.tabs.source.append(this.targets.element);
            }
            this.configuration();
        } else {
            this.tabs.prompt.append(field(this.w('generationPrompt'), this.prompt), element('p', 'mdx-study__hint', this.w('generationUnavailable')));
            this.tabs.result.prepend(imports); this.tabs.show('result');
        }
        this.addPromptSave(this.tabs.prompt);
    }
    private configuration(): void {
        if (!this.creation.generation?.configurationUrl) return;
        const link = element('a', 'mdx-study__button mdx-study__button--quiet', this.w('configureGeneration'));
        link.href = this.creation.generation?.configurationUrl; link.target = '_blank'; link.rel = 'noopener noreferrer';
        (this.targets?.element ?? this.tabs.source).append(link);
    }
    private addPromptSave(container: HTMLElement): void {
        if (this.creation.prompts?.store?.saveList) {
            this.prompts = new StudyPrompts(this.creation.prompts!, this.prompt, this.w, (action) => this.perform('save-prompts', action));
            const label = this.prompt.parentElement!; label.before(this.prompts.element); return;
        }
        if (!this.creation.prompts?.store) return;
        const save = studyButton(this.w('savePrompt'), () => {void this.perform('save-prompt', async () => {
            await this.creation.prompts?.store!.save(this.prompt.value); save.textContent = this.w('promptSaved');
        });}, 'quiet');
        this.prompt.oninput = () => {save.textContent = this.w('savePrompt');}; container.append(save);
    }
    private async loadPrompt(): Promise<void> {
        if (!this.creation.prompts?.store) return;
        const initial = this.prompt.value, operationId = randomUUID(), started = Date.now();
        try {
            if (this.prompts) {await this.prompts.load(this.controller.signal); this.updateActions(); return;}
            const saved = await this.creation.prompts?.store.load(this.controller.signal);
            if (!this.controller.signal.aborted && saved !== undefined && this.prompt.value === initial) this.prompt.value = saved;
            this.updateActions();
        } catch (error) {
            if (this.controller.signal.aborted) return;
            const {code} = studyFailure(error), message = this.w('error.' + code);
            this.status.textContent = `${message === 'study.error.' + code ? this.w('failed') : message} (${code})`;
            console.warn('[StudyCreation]', {operationId, operation: 'study.prompt', stage: 'load', result: 'failure', code, durationMs: Date.now() - started});
        }
    }
    private actions(): void {
        const actions = element('div', 'mdx-study-create__actions');
        const save = this.save = element('button', 'mdx-study__button mdx-study__button--primary', this.w('saveOpen')); save.type = 'submit'; save.setAttribute('aria-label', this.w('saveNote'));
        if (this.generate) actions.append(this.generate);
        actions.append(this.closeButton, studyButton(this.w('newDraft'), () => this.newDraft(), 'quiet'), save);
        this.tabs.result.append(this.fields); this.tabs.prompt.append(studySyntaxHelp(this.w, rules => {
            if (!this.prompt.value.includes(rules)) this.prompt.value = [this.prompt.value.trim(), rules].filter(Boolean).join('\n\n');
            this.prompt.dispatchEvent(new Event('input', {bubbles: true}));
            this.tabs.show('prompt'); this.prompt.focus();
        })); actions.prepend(this.status); this.form.append(this.replaceLabel, this.execution, actions);
        this.form.onsubmit = event => {
            event.preventDefault(); this.updateActions(); if (this.save?.disabled) return; this.tabs.show('result'); if (!this.title.value.trim()) {this.title.focus(); this.title.reportValidity(); return;}
            void this.perform('save', async () => {
                const draft = {operationId: this.state.draftId, title: this.title.value.trim(), content: this.content.value, parent: this.destination.value()};
                const receipt = await this.creation.documents.save(draft);
                const cleared = await this.recovery?.clear(); this.resetDraft();
                if (cleared === false) this.recoveryNotice.textContent = this.w('savedDraftClearFailed');
                return this.w('saved') + (receipt?.label ?? draft.title);
            });
        };
    }
    private newDraft(): void {
        if (this.busy || this.closed) return;
        if (!this.recovery) {this.resetDraft(); return;}
        void this.perform('new-draft', async () => {await this.recovery?.clear(); this.resetDraft();});
    }
    private resetDraft(): void {
        this.state.reset();
        this.execution.replaceChildren(); this.title.value = ''; this.source.value = ''; this.content.value = '';
        this.executionState = undefined; this.recoveryNotice.textContent = '';
        this.replace.checked = false; this.replaceLabel.hidden = true; this.status.textContent = '';
        if (this.generate) this.generate.textContent = this.w('generateDraft');
        this.form.querySelectorAll<HTMLInputElement>('input[type="file"]').forEach(input => {input.value = '';});
        this.form.querySelectorAll<HTMLSelectElement>('.mdx-study-create__imports select').forEach(select => {select.value = ''; select.hidden = true;});
        this.updateActions(); this.preview.reset(); this.tabs.show(this.creation.generation ? 'source' : 'result'); (this.creation.generation ? this.source : this.title).focus();
        console.debug('[StudyCreation]', {operationId:this.state.draftId, operation:'study.create', stage:'new-draft', result:'success', durationMs:0});
    }
    private updateActions(): void {
        const edited = !!this.content.value && this.content.value !== this.state.generated;
        this.replaceLabel.hidden = !edited || !this.creation.generation;
        if (this.generate) this.generate.disabled = this.busy || !this.source.value.trim() || /^@[^\n]*$/.test(this.source.value.trim()) || !this.prompt.value.trim() || this.targets?.valid() === false || (edited && !this.replace.checked);
        if (this.save) this.save.disabled = this.busy || !this.title.value.trim() || /[\\/\x00-\x1f]/.test(this.title.value) || !this.content.value.trim() || !this.destination.valid();
    }
    private generateDraft(): void {
        this.updateActions(); if (this.generate?.disabled) return;
        if (this.state.pendingOperation && this.creation.generation?.resume) {void this.resumePending(); return;}
        if (!this.prompt.value.trim()) {this.status.textContent = this.w('promptRequired'); this.tabs.show('prompt'); this.prompt.focus(); return;}
        if (this.content.value && this.content.value !== this.state.generated && !this.replace.checked) {
            this.replaceLabel.hidden = false; this.status.textContent = this.w('replaceHint'); return;
        }
        void this.perform('generate', async operationId => {
            const draftId = this.state.draftId; this.state.begin(operationId); this.checkpoint(); if (this.recovery) await this.recovery.flush();
            const result = await this.creation.generation!.generate({operationId, draftId: this.state.draftId, title: this.title.value.trim(), promptName: this.prompts?.selectedName(),
                onExecution: execution => {
                    if (this.state.accepts(draftId, operationId)) this.showExecution(execution);
                }, targetId: this.targets?.value(), modelId: this.targets?.modelId(), prompt: this.prompt.value, source: this.source.value,
                previousDraft: this.content.value, signal: this.controller.signal});
            this.acceptGenerated(result);
        });
    }
    private async perform(stage: string, action: (operationId: string) => Promise<void | string>): Promise<void> {
        if (this.busy || this.closed) return; this.busy = true; this.saving = stage === 'save';
        const operationId = this.saving ? this.state.draftId : randomUUID(), started = Date.now();
        this.status.dataset.state = 'working'; this.status.textContent = this.w(this.saving ? 'saving' : 'working');
        const controls = [...this.form.querySelectorAll<FormControl>('input,button,textarea,select')];
        controls.forEach(control => {control.disabled = true;}); this.closeButton.disabled = this.saving;
        let completed = false;
        try {
            const message = await action(operationId); completed = true;
            if (!this.closed) {this.status.textContent = message ?? ''; this.status.dataset.state = 'success';}
            console.debug('[StudyCreation]', {operationId, operation: 'study.create', stage, result: 'success', durationMs: Date.now() - started});
        } catch (error) {this.actionFailed(stage, error, operationId, Date.now() - started);}
        finally {this.finishAction(stage, completed, controls);}
    }
    private actionFailed(stage: string, error: unknown, operationId: string, durationMs: number): void {
        if (this.controller.signal.aborted) return;
        const {code} = studyFailure(error); if (!this.closed) this.showFailure(stage, code);
        if (stage === 'generate' || stage === 'resume-generation') {
            this.state.fail(error); this.checkpoint();
        }
        console.warn('[StudyCreation]', {operationId, operation: 'study.create', stage, result: 'failure', code, durationMs});
    }
    private showFailure(stage: string, code: string): void {
        const translated = this.w('error.' + code);
        const message = translated === 'study.error.' + code ? this.w(stage === 'save' ? 'saveFailed' : 'failed') : translated;
        this.status.dataset.state = 'error'; this.status.textContent = `${message} (${code})`;
    }
    private finishAction(stage: string, completed: boolean, controls: FormControl[]): void {
        this.busy = false; this.saving = false; controls.forEach(control => {control.disabled = false;}); this.updateActions();
        if (completed && !this.closed && (stage === 'save' || stage === 'new-draft')) (this.creation.generation ? this.source : this.title).focus();
    }
}
function field(text: string, input: HTMLElement): HTMLLabelElement {
    const label = element('label'); label.append(element('span', '', text), input); return label;
}
function sourceControls(host: StudyHost, target: HTMLTextAreaElement, perform: (stage: string, action: () => Promise<void>) => Promise<void>, signal: AbortSignal, w: StudyText): HTMLElement {
    const controls = element('div', 'mdx-study-create__imports'), file = element('input'), choices = element('select');
    file.type = 'file'; file.accept = '.txt,.md,.mdx,.markdown,.mind'; file.hidden = true; choices.hidden = true; choices.setAttribute('aria-label', w('chooseSource'));
    const apply = (content: string) => {if (!signal.aborted) {target.value = content; target.dispatchEvent(new Event('input', {bubbles: true}));}};
    file.onchange = () => {const selected = file.files?.[0]; if (!selected) return; void perform('read-local-source', async () => {
        if (selected.size > 8 * 1024 * 1024) throw Object.assign(new Error('Source too large'), {code: 'SOURCE_TOO_LARGE'});
        apply(await selected.text());
    });};
    const existing = studyButton(w('chooseSource'), () => {void perform('list-sources', async () => {
        const documents = await sourceDocuments(host, signal); if (signal.aborted) return;
        choices.replaceChildren(new Option(w('chooseSource'), '')); documents.forEach(entry => choices.append(new Option(entry.title, entry.id))); choices.hidden = false;
    });}, 'quiet');
    const search = host.creation?.sources ? new StudySourceSearch(host.creation.sources, signal, w, content => {void perform('read-source', async () => apply(await content()));}, target) : undefined;
    choices.onchange = () => {if (choices.value) void perform('read-source', async () => apply((await host.read(choices.value)).content));};
    controls.append(studyButton(w('pasteSource'), () => {const details = target.closest('details'); if (details) details.open = true; target.focus();}, 'quiet'), studyButton(w('importLocal'), () => file.click(), 'quiet'), ...(search ? [search.button, file, search.element] : [existing, file, choices])); return controls;
}
async function sourceDocuments(host: StudyHost, signal: AbortSignal): Promise<StudyEntry[]> {
    const pending = (await host.list()).map(entry => ({entry, prefix: ''})), visited = new Set<string>(), result: StudyEntry[] = [];
    while (pending.length && !signal.aborted) {
        const {entry, prefix} = pending.shift()!; if (visited.has(entry.id)) continue; visited.add(entry.id);
        if (entry.kind === 'document') result.push({...entry, title: prefix + entry.title});
        else pending.push(...(await host.list(entry.id)).map(child => ({entry: child, prefix: prefix + entry.title + ' / '})));
    }
    return result;
}
