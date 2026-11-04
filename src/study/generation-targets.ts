import type {StudyGeneration} from './contracts';
import type {StudyText} from './locale';
import {element, studyButton} from './dom';
import {studyFailure} from './operations';
import {randomUUID} from '../utils/random';
/** Opaque generation targets keep provider configuration outside the editor. */
export class StudyGenerationTargets {
    readonly element = element('div', 'mdx-study-create__models');
    private select = element('select');
    private model = element('select');
    private targets: Awaited<ReturnType<NonNullable<StudyGeneration['targets']>['list']>> = [];
    private selectedModels = new Map<string, string>();
    private status = element('p', 'mdx-study__hint');
    private loading = false;
    private ready = false;
    constructor(private host: NonNullable<StudyGeneration['targets']>, private w: StudyText, private signal: AbortSignal, private changed: () => void = () => {}) {
        this.select.setAttribute('aria-label', w('generationModel')); this.model.setAttribute('aria-label', w('modelChoice'));
        const label = element('label'); label.append(element('span', '', w('generationModel')), this.select);
        const modelLabel = element('label'); modelLabel.append(element('span', '', w('modelChoice')), this.model);
        this.select.onchange = () => {this.updateModels(); this.changed();};
        this.model.onchange = () => {this.selectedModels.set(this.select.value, this.model.value); this.changed();};
        this.status.setAttribute('role', 'status');
        this.element.append(label, modelLabel, studyButton(w('refreshModels'), () => {void this.load();}, 'quiet'), this.status);
        void this.load();
    }
    valid(): boolean {try {this.value(); this.modelId(); return true;} catch {return false;}}
    private restored?: {targetId?: string; modelId?: string};
    capture(): {targetId?: string; modelId?: string} {return this.ready ? {targetId: this.select.value || undefined, modelId: this.model.value || undefined} : this.restored ?? {};}
    restore(targetId?: string, modelId?: string): void {
        this.restored = {targetId, modelId}; if (!this.ready) return;
        if (targetId) this.select.value = targetId;
        if (targetId && modelId) this.selectedModels.set(targetId, modelId);
        this.updateModels(); this.changed();
    }
    value(): string {
        const option = this.select.selectedOptions[0];
        if (!this.ready || !option?.value || option.disabled) throw Object.assign(new Error('Select an available model connection'), {code: 'TEXT_MODEL_UNAVAILABLE'});
        return option.value;
    }
    modelId(): string | undefined {
        const target = this.targets.find(item => item.id === this.value());
        if (!target?.models) return undefined;
        if (!this.model.value) throw Object.assign(new Error('Select a model'), {code:'TEXT_MODEL_UNAVAILABLE'});
        return this.model.value;
    }
    private updateModels(): void {
        const target = this.targets.find(item => item.id === this.select.value);
        this.model.parentElement!.hidden = !target?.models;
        this.model.replaceChildren(new Option(this.w('modelChoice'), ''), ...(target?.models ?? []).map(item => new Option(item.label, item.id)));
        this.model.value = this.selectedModels.get(this.select.value) || target?.model || target?.models?.[0]?.id || '';
    }
    private async load(): Promise<void> {
        if (this.loading || this.signal.aborted) return;
        this.loading = true; this.ready = false; this.changed(); this.select.disabled = true;
        const selected = this.select.value, operationId = randomUUID(), started = Date.now(); this.status.textContent = this.w('loadingModels');
        try {
            const targets = await this.host.list(this.signal); if (this.signal.aborted) return; this.targets = targets;
            this.select.replaceChildren(new Option(this.w('chooseModel'), ''));
            for (const target of targets) {
                const reason = target.reason ? this.w('error.' + target.reason) : '';
                const option = new Option(target.label + (target.disabled && reason ? ' — ' + reason : ''), target.id);
                option.disabled = !!target.disabled; this.select.append(option);
            }
            this.select.value = selected || targets.find(target => target.default && !target.disabled)?.id || targets.find(target => !target.disabled)?.id || '';
            this.updateModels(); this.ready = true; if (this.restored) this.restore(this.restored.targetId, this.restored.modelId);
            this.status.textContent = targets.some(target => !target.disabled) ? '' : this.w('noModels');
            console.debug('[StudyGenerationTargets]', {operationId, stage: 'list-models', result: 'success', count: targets.length, durationMs: Date.now() - started});
        } catch (error) {
            if (this.signal.aborted) return;
            const {code} = studyFailure(error); this.status.textContent = `${this.w('modelsFailed')} (${code})`;
            console.warn('[StudyGenerationTargets]', {operationId, stage: 'list-models', result: 'failure', code, durationMs: Date.now() - started});
        } finally {this.loading = false; this.select.disabled = false; this.changed();}
    }
}
