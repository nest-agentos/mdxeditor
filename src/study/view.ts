import type {StudyCard, StudyHost, StudyChange, StudyEntry, StudyCreationState} from './contracts';
import {studyDue} from './cards';
import {loadStudyCatalog, reloadStudyProgress, studyCounts, type StudyCatalog, type StudyItem} from './catalog';
import {nextReview} from '../plugins/cloze/memory.plugin';
import {randomUUID} from '../utils/random';
import {studyFailure, studyStep} from './operations';
import {element, progress, studyButton} from './dom';
import {studyList, refreshStudyList} from './list';
import {studyText} from './locale';
import {reviewSnapshot} from '../plugins/cloze/review-history';
import {saveStudyReview} from './review';
import {progressChart, type ChartSettings} from './chart';
import type {ProgressDocument} from './progress-data';
import {mergeStudyChange} from './refresh';
import {createStudyDocument} from './creation';

/** Standalone view: source navigation and durable storage remain host-owned. */
export class StudyView {
    private root = element('section', 'mdx-study');
    private status = element('p', 'mdx-study__status');
    private body = element('div', 'mdx-study__body');
    private selected = new Set<string>();
    private catalog: StudyCatalog = {nodes: [], items: [], history: new Map()};
    private summaryPanel?: HTMLElement;
    private listPanel?: HTMLElement;
    private fileChartSettings = new Map<string, ChartSettings>();
    private chartSettings: ChartSettings = {range: 30, mode: 'coverage'};
    private queue: StudyItem[] = [];
    private answered = new Set<string>();
    private attempts = 0;
    private sessionSize = 0;
    private busy: Promise<void> = Promise.resolve();
    private active = false;
    private closed = false;
    private practice = false;
    private loaded = false;
    private revealed = false;
    private current?: StudyItem;
    private timer?: ReturnType<typeof setTimeout>;
    private refreshTimer?: ReturnType<typeof setTimeout>;
    private pendingChange?: StudyChange;
    private refreshBlocked = false;
    private sessionActive = false;
    private stopWatching?: () => void;
    private lifetime = new AbortController();
    private creating = false;
    private dueTimer?: ReturnType<typeof setTimeout>;
    private stores = new Map<string, ReturnType<StudyHost['store']>>();
    private w;
    constructor(container: HTMLElement, private host: StudyHost) {
        this.w = studyText(host.locale ?? 'zh-CN'); this.status.setAttribute('role', 'status'); this.root.tabIndex = -1;
        const header = element('header', 'mdx-study__header'), copy = element('div');
        copy.append(element('h2', 'mdx-study__title', this.w('title')), element('p', 'mdx-study__intro', this.w('intro')));
        const actions = element('div', 'mdx-study__header-actions');
        if (host.creation) actions.append(this.button(host.creation.label ?? this.w('newDocument'), () => {void this.createDocument();}, 'primary'));
        actions.append(this.button(this.w('refresh'), () => this.run(() => this.scan(), 'scan'), 'quiet')); header.append(copy, actions);
        this.root.append(header, this.status, this.body); container.append(this.root);
        this.root.addEventListener('keydown', event => this.keydown(event));
        this.stopWatching = host.watch?.(change => this.invalidate(change));
        document.addEventListener('visibilitychange', () => {if (!document.hidden) this.invalidate({type: 'progress'});}, {signal: this.lifetime.signal});
        this.run(() => this.scan(), 'scan');
        void this.busy.then(() => this.restoreCreation());
    }
    private now(): number {return this.host.now?.() ?? Date.now();}
    private store(id: string) {if (!this.stores.has(id)) this.stores.set(id, this.host.store(id)); return this.stores.get(id)!;}
    private button(label: string, action: () => void, variant = ''): HTMLButtonElement {
        return studyButton(label, () => {if (!this.active && !this.closed) action();}, variant);
    }
    private run(action: () => Promise<void>, stage = 'read'): void {
        if (this.active || this.closed) return;
        this.active = true; this.root.setAttribute('aria-busy', 'true'); this.status.textContent = '';
        const operationId = randomUUID(), started = this.now();
        this.busy = action().then(() => {
            console.debug('[StudyView]', {operationId, operation: 'study.' + stage, stage, result: 'success', durationMs: this.now() - started, cards: this.catalog.items.length});
        }).catch(error => {
            const failure = studyFailure(error);
            if (!this.closed) this.status.textContent = failure.code === 'DOCUMENT_CHANGED' ? this.w('changed') : `${this.w('failed')} (${failure.code})`;
            console.warn('[StudyView]', {operationId, operation: 'study.' + stage, stage: failure.stage ?? stage, result: 'failure', durationMs: this.now() - started, code: failure.code});
        }).finally(() => {this.active = false; this.root.setAttribute('aria-busy', 'false'); this.scheduleRefresh();});
    }
    private async scan(): Promise<void> {
        clearTimeout(this.timer); this.current = undefined; this.status.textContent = this.w('loading');
        const catalog = await loadStudyCatalog(this.host, id => this.store(id), () => this.closed);
        if (this.closed) return;
        const all = !this.loaded || this.catalog.items.every(item => this.selected.has(item.card.document));
        const ids = new Set(catalog.items.map(item => item.card.document));
        this.selected = all ? ids : new Set([...this.selected].filter(id => ids.has(id)));
        this.catalog = catalog; this.loaded = true; this.overview();
    }
    private overview(): void {
        clearTimeout(this.timer); this.current = undefined; this.sessionActive = false; this.status.textContent = ''; this.body.replaceChildren();
        if (!this.catalog.items.length) {this.empty('empty', 'emptyHint'); return;}
        const summary = element('div', 'mdx-study__summary'); this.summaryPanel = summary; this.body.append(summary);
        const heading = element('div', 'mdx-study__list-heading'), copy = element('div'), actions = element('div', 'mdx-study__list-actions');
        copy.append(element('h3', '', this.w('scope')), element('p', 'mdx-study__hint', this.w('scopeHint')));
        for (const all of [true, false]) actions.append(this.button(this.w(all ? 'all' : 'clear'), () => {
            this.selected = all ? new Set(this.catalog.items.map(item => item.card.document)) : new Set(); this.overview();
        }, 'quiet'));
        heading.append(copy, actions); this.body.append(heading);
        this.listPanel = studyList(this.catalog.nodes, this.selected, this.now(), this.w, () => this.summary(summary),
            node => {
                if (!this.fileChartSettings.has(node.entry.id)) this.fileChartSettings.set(node.entry.id, {range: 30, mode: 'coverage'});
                return this.chart(node.items, this.fileChartSettings.get(node.entry.id));
            }, id => {if (!this.active && !this.closed) void this.openSource(id);}, this.host.creation ? parent => {void this.createDocument(parent);} : undefined);
        this.body.append(this.listPanel);
        this.summary(summary); this.scheduleRefresh();
    }
    private selectedItems(): StudyItem[] {return this.catalog.items.filter(item => this.selected.has(item.card.document));}
    private summary(container: HTMLElement): void {
        container.replaceChildren(); const items = this.selectedItems(), counts = studyCounts(items, this.now());
        const metrics = element('div', 'mdx-study__metrics');
        for (const key of ['total', 'fresh', 'due', 'scheduled'] as const) {
            const metric = element('div', 'mdx-study__metric'); metric.dataset.kind = key;
            const label = element('span', '', this.w(key) + ' '), value = element('strong', '', String(counts[key]));
            metric.setAttribute('aria-label', `${this.w(key)} ${counts[key]}`); metric.append(label, value); metrics.append(metric);
        }
        const footer = element('div', 'mdx-study__launch'), copy = element('div'), actions = element('div', 'mdx-study__launch-actions');
        const files = new Set(items.map(item => item.card.document)).size;
        copy.append(element('strong', '', `${this.w('selected')} ${files} ${this.w('files')} · ${this.w('learned')} ${counts.learned}/${counts.total}`),
            element('p', 'mdx-study__hint', this.w(!items.length ? 'none' : counts.fresh + counts.due ? 'ready' : 'caughtUp')));
        for (const practice of [false, true]) {
            const button = this.button(this.w(practice ? 'practice' : 'start'), () => this.start(practice), practice ? 'secondary' : 'primary');
            button.disabled = practice ? !items.length : !counts.fresh && !counts.due; actions.append(button);
        }
        footer.append(copy, actions); container.append(metrics, footer, this.chart(items, this.chartSettings)); this.scheduleDueRefresh();
    }
    private chart(items: StudyItem[], settings?: ChartSettings): HTMLElement {
        const grouped = new Map<string, StudyItem[]>();
        for (const item of items) {const group = grouped.get(item.card.document) ?? []; group.push(item); grouped.set(item.card.document, group);}
        const documents: ProgressDocument[] = [...grouped].map(([id, values]) => ({id, title: values[0]!.card.title,
            current: reviewSnapshot(values.map(value => value.card.locator), studyCounts(values, this.now()).learned),
            events: this.catalog.history.get(id) ?? []}));
        return progressChart(documents, this.now(), this.w, this.host.locale ?? 'zh-CN', settings);
    }
    private start(practice: boolean): void {
        this.sessionActive = true; this.practice = practice; this.answered.clear(); this.attempts = 0;
        this.queue = this.selectedItems().filter(item => practice || studyDue(item.state, this.now()));
        this.sessionSize = this.queue.length; this.next();
    }
    private next(): void {
        if (this.closed) return;
        clearTimeout(this.timer); this.current = undefined; this.revealed = false; this.body.replaceChildren();
        const heading = element('div', 'mdx-study__session-heading'); heading.append(this.button(this.w('overview'), () => this.overview(), 'quiet'));
        heading.append(element('span', 'mdx-study__hint', `${this.w('attempts')} ${this.attempts}`)); this.body.append(heading);
        this.status.textContent = `${this.w('answered')} ${this.answered.size}/${this.sessionSize}`;
        this.body.append(progress(this.answered.size, this.sessionSize, this.status.textContent));
        const item = [...this.queue].sort((a, b) => this.dueAt(a) - this.dueAt(b)).find(value =>
            this.practice ? !this.answered.has(this.id(value.card)) : studyDue(value.state, this.now()));
        if (item) {this.current = item; this.show(item); this.root.focus({preventScroll: true}); return;}
        const waiting = this.queue.filter(value => value.state && value.state.interval < 1);
        this.empty(waiting.length && !this.practice ? 'waiting' : 'complete', waiting.length && !this.practice ? 'waitingHint' : 'completeHint');
        if (waiting.length && !this.practice) this.wait(waiting);
    }
    private dueAt(item: StudyItem): number {return item.state ? Date.parse(item.state.dueAt ?? '') || 0 : Infinity;}
    private wait(items: StudyItem[]): void {
        const due = Math.min(...items.map(value => Date.parse(value.state!.dueAt!)));
        this.body.append(element('p', 'mdx-study__hint', new Date(due).toLocaleTimeString(this.host.locale ?? 'zh-CN')));
        this.timer = setTimeout(() => this.next(), Math.min(Math.max(1000, due - this.now()), 60_000));
    }
    private empty(title: string, hint: string): void {
        const empty = element('div', 'mdx-study__empty');
        empty.append(element('h3', '', this.w(title)), element('p', 'mdx-study__hint', this.w(hint))); this.body.append(empty);
    }
    private id(card: StudyCard): string {return JSON.stringify([card.document, card.locator]);}
    private show(item: StudyItem): void {
        const card = element('article', 'mdx-study__card'), header = element('div', 'mdx-study__card-header');
        const title = element('span', 'mdx-study__hint', item.card.title); title.title = item.card.document;
        header.append(title, this.button(this.w('source'), () => {void this.openSource(item.card.document);}, 'quiet'));
        card.append(header, element('p', 'mdx-study__eyebrow', this.w('question')), element('div', 'mdx-study__question', item.card.question));
        const actions = element('div', 'mdx-study__review-actions');
        actions.append(this.button(this.w('reveal'), () => this.reveal(item, card, actions), 'primary'));
        this.body.append(card, actions, element('p', 'mdx-study__keyboard', this.w(this.practice ? 'practiceHint' : 'shortcut')));
    }
    private reveal(item: StudyItem, card: HTMLElement, actions: HTMLElement): void {
        if (this.revealed) return; this.revealed = true; actions.replaceChildren();
        const answer = element('div', 'mdx-study__answer'); answer.setAttribute('aria-live', 'polite');
        answer.append(element('span', 'mdx-study__eyebrow', this.w('answer')), element('p', '', item.card.answer)); card.append(answer);
        for (let grade = 1; grade <= 4; grade++) {
            const next = nextReview(item.state, grade, this.now()), key = ['again', 'hard', 'good', 'easy'][grade - 1]!;
            const interval = next.interval < 1 ? `${Math.round(next.interval * 1440)} ${this.w('minutes')}` : `${Math.round(next.interval)} ${this.w('days')}`;
            const button = this.button(this.w(key), () => this.run(() => this.grade(item, grade), 'grade'), key);
            if (!this.practice) button.append(element('small', '', interval)); actions.append(button);
        }
        this.root.focus({preventScroll: true});
    }
    private async createDocument(parent?: StudyEntry, restored?: StudyCreationState): Promise<void> {
        if (this.creating || this.closed || this.active) return;
        this.creating = true;
        try {await createStudyDocument(this.root, this.host, this.w, this.lifetime.signal, parent, restored);}
        finally {this.creating = false;}
    }
    private async restoreCreation(): Promise<void> {
        if (!this.host.creation?.recovery) return;
        try {
            const draft = await this.host.creation.recovery.load(this.lifetime.signal);
            if (draft && !this.closed && !this.creating) void this.createDocument(draft.parent, draft);
        } catch (error) {
            if (this.closed) return;
            this.status.textContent = this.w('draftCheckpointFailed');
            console.warn('[StudyDraft]', {operationId: randomUUID(), stage: 'restore', result: 'failure', code: studyFailure(error).code});
        }
    }
    private async openSource(id: string): Promise<void> {
        const operationId = randomUUID(), started = this.now();
        try {await this.host.open(id);}
        catch (error) {
            const {code} = studyFailure(error);
            if (!this.closed) this.status.textContent = `${this.w('failed')} (${code})`;
            console.warn('[StudyView]', {operationId, operation: 'study.open', stage: 'source-open', result: 'failure', code, durationMs: this.now() - started});
        }
    }
    private keydown(event: KeyboardEvent): void {
        if (this.active || !this.current || event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
        if ((event.target as Element).closest('input, textarea, button, a, [contenteditable=true]')) return;
        const key = event.key === ' ' || event.key === 'Enter' ? 'reveal' : ['again', 'hard', 'good', 'easy'][Number(event.key) - 1];
        if (!key || (key !== 'reveal' && !this.revealed)) return;
        event.preventDefault(); this.body.querySelector<HTMLButtonElement>('.mdx-study__button--' + (key === 'reveal' ? 'primary' : key))?.click();
    }
    private async grade(item: StudyItem, grade: number): Promise<void> {
        const source = await studyStep('source-read', () => this.host.read(item.card.document));
        if (source.revision !== item.card.revision) throw Object.assign(new Error(this.w('changed')), {code: 'DOCUMENT_CHANGED'});
        if (!this.practice) {
            const document = this.catalog.items.filter(value => value.card.document === item.card.document);
            const result = await saveStudyReview(this.store(item.card.document), item, document, grade, this.now());
            document.forEach((value, index) => {value.state = result.states[index];});
            this.catalog.history.set(item.card.document, result.events);
        }
        this.answered.add(this.id(item.card)); this.attempts++; this.next();
    }
    private invalidate(change: StudyChange): void {
        if (this.closed) return;
        this.pendingChange = mergeStudyChange(this.pendingChange, change); this.refreshBlocked = false; this.scheduleRefresh();
    }
    private scheduleDueRefresh(): void {
        clearTimeout(this.dueTimer);
        const due = Math.min(...this.catalog.items.map(item => Date.parse(item.state?.dueAt ?? '')).filter(time => time > this.now()));
        if (Number.isFinite(due)) this.dueTimer = setTimeout(() => this.invalidate({type: 'progress'}), Math.min(due - this.now() + 1, 2147483647));
    }
    private scheduleRefresh(): void {
        if (!this.pendingChange || this.closed || this.active || this.refreshTimer || this.refreshBlocked) return;
        if (!this.root.isConnected || this.root.closest('[hidden]') || document.hidden) return;
        if (this.sessionActive) return;
        this.refreshTimer = setTimeout(() => {this.refreshTimer = undefined; void this.refresh();}, 120);
    }
    /** Hosts may call this when a retained view becomes active, including clock-only due changes. */
    async refresh(): Promise<void> {
        clearTimeout(this.refreshTimer); this.refreshTimer = undefined;
        await this.busy; if (this.closed || this.active) return;
        const change = this.pendingChange ?? {type: 'progress'};
        if (this.sessionActive) return;
        this.pendingChange = undefined; this.refreshBlocked = false;
        this.run(async () => {
            try {
                if (change.type === 'sources' || !this.loaded) await this.scan();
                else {
                    await reloadStudyProgress(this.catalog, id => this.store(id), change.documents);
                    if (!this.closed && !this.sessionActive) {
                        if (this.summaryPanel) this.summary(this.summaryPanel);
                        if (this.listPanel) refreshStudyList(this.listPanel, this.now(), change.documents);
                    }
                }
            } catch (error) {
                this.pendingChange = mergeStudyChange(this.pendingChange, change); this.refreshBlocked = true; throw error;
            }
        }, change.type === 'sources' ? 'source-refresh' : 'progress-refresh');
        await this.busy;
    }
    async flush(): Promise<void> {await this.busy;}
    async destroy(): Promise<void> {
        this.closed = true; clearTimeout(this.timer); clearTimeout(this.refreshTimer); clearTimeout(this.dueTimer);
        this.lifetime.abort(); this.stopWatching?.(); await this.busy;
        this.stores.forEach(store => store.destroy?.()); this.root.remove();
    }
}
