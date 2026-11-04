import {t} from '../utils/i18n';
import {copyText} from '@nestos/ui-common';
export interface ContentTime {value: number; label: string}
export interface ContentViewOptions {
    title?: string; subtitle?: string; preview?: string; avatar?: string; variant?: 'card' | 'plain'; expanded?: boolean;
    locale?: 'zh-CN' | 'en';
    labels?: Partial<Record<'expand' | 'collapse' | 'details' | 'copy' | 'more', string>>;
    onToggle?(expanded: boolean): void;
}
function node<K extends keyof HTMLElementTagNameMap>(tag: K, name: string): HTMLElementTagNameMap[K] {
    const item = document.createElement(tag); item.className = ['mdx-content-view', name].join('__'); return item;
}
/** A domain-neutral reading frame. Hosts retain ownership of body renderers and business actions. */
export class ContentView {
    readonly element = document.createElement('article');
    readonly header = node('header', 'header');
    readonly toggle = node('button', 'toggle');
    readonly avatar = node('span', 'avatar');
    readonly heading = node('span', 'heading');
    readonly title = node('strong', 'title');
    readonly subtitle = node('span', 'subtitle');
    readonly preview = node('span', 'preview');
    readonly timing = node('details', 'timing');
    readonly timeSummary = node('summary', 'time-summary');
    readonly time = node('time', 'time');
    readonly timeDetails = node('dl', 'time-details');
    readonly status = node('span', 'status');
    readonly metadata = node('div', 'metadata');
    readonly body = node('div', 'body');
    readonly actions = node('footer', 'actions');
    readonly copyButton = node('button', 'action');
    readonly more = node('details', 'more');
    readonly moreButton = node('button', 'action');
    readonly moreBody = node('div', 'menu');
    private copySource: () => string = () => this.body.textContent ?? '';
    private copyError?: (error: unknown) => void;
    private readonly abort = new AbortController();
    private expanded = true;
    private readonly locale: 'zh-CN' | 'en';
    private readonly labels: Record<'expand' | 'collapse' | 'details' | 'copy' | 'more', string>;
    constructor(options: ContentViewOptions = {}) {
        this.locale = options.locale ?? 'zh-CN';
        const text = (key: string) => t('editor.content.' + key, this.locale);
        this.labels = {expand: text('expand'), collapse: text('collapse'), details: text('details'), copy: text('copy'), more: text('more'), ...options.labels};
        this.element.className = 'mdx-content-view'; this.element.dataset.variant = options.variant ?? 'plain';
        this.avatar.hidden = this.title.hidden = this.subtitle.hidden = this.preview.hidden = true;
        this.toggle.type = 'button'; this.avatar.setAttribute('aria-hidden', 'true');
        this.heading.append(this.title, this.subtitle, this.preview); this.toggle.append(this.avatar, this.heading);
        this.timeSummary.append(this.time); this.timing.append(this.timeSummary, this.timeDetails); this.timing.hidden = true;
        this.header.append(this.toggle, this.status, this.timing); this.element.append(this.header, this.metadata, this.body, this.actions);
        this.toggle.addEventListener('click', () => {this.setExpanded(!this.expanded); options.onToggle?.(this.expanded);}, {signal: this.abort.signal});
        const summary = node('summary', 'more-summary'); this.moreButton.type = this.copyButton.type = 'button';
        this.moreButton.textContent = this.labels.more; summary.append(this.moreButton); this.more.append(summary, this.moreBody); this.more.hidden = true;
        this.moreButton.addEventListener('click', event => {event.preventDefault(); this.more.open = !this.more.open;}, {signal: this.abort.signal});
        this.copyButton.addEventListener('click', () => {void this.copy();}, {signal: this.abort.signal});
        this.setCopySource(this.copySource, this.labels.copy); this.actions.append(this.more);
        this.update(options); this.setExpanded(options.expanded ?? true);
    }
    update(value: Pick<ContentViewOptions, 'title' | 'subtitle' | 'preview' | 'avatar'>): void {
        for (const key of ['title', 'subtitle', 'preview', 'avatar'] as const) {
            if (!(key in value)) continue;
            this[key].textContent = value[key] ?? ''; this[key].hidden = !value[key];
        }
        this.setExpanded(this.expanded);
    }
    setExpanded(expanded: boolean): void {
        const changed = this.expanded !== expanded;
        this.expanded = expanded; this.element.classList.toggle('is-collapsed', !expanded);
        this.body.hidden = this.metadata.hidden = !expanded;
        this.preview.hidden = expanded || !this.preview.textContent;
        this.toggle.setAttribute('aria-expanded', String(expanded));
        const label = expanded ? this.labels.collapse : this.labels.expand;
        this.toggle.setAttribute('aria-label', this.title.textContent ? `${label}: ${this.title.textContent}` : label);
        if (changed) this.element.dispatchEvent(new CustomEvent('mdx:content-expanded', {bubbles: true}));
    }
    private async copy(): Promise<void> {
        try {if (!await copyText(this.copySource())) throw new Error('CONTENT_COPY_FAILED');}
        catch (error) {if (!this.abort.signal.aborted) this.copyError?.(error);}
    }
    setCopySource(read: () => string, label: string, onError?: (error: unknown) => void): void {
        this.copySource = read; this.copyError = onError;
        this.copyButton.textContent = label; this.copyButton.setAttribute('aria-label', label); this.copyButton.title = label;
        if (this.copyButton.parentElement !== this.actions) this.actions.append(this.copyButton);
    }
    getExpanded(): boolean {return this.expanded;}
    setTimes(primary: ContentTime | undefined, details: readonly ContentTime[] = [], locale: string = this.locale): void {
        const valid = (item: ContentTime | undefined): item is ContentTime => !!item && Number.isFinite(item.value) && item.value > 0 && Number.isFinite(new Date(item.value).getTime());
        this.timing.hidden = !valid(primary); this.timeDetails.replaceChildren();
        if (!valid(primary)) return;
        const date = new Date(primary.value);
        this.time.dateTime = date.toISOString();
        const today = new Date(), sameDay = date.toDateString() === today.toDateString();
        this.time.textContent = `${primary.label} ${date.toLocaleString(locale, {hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
            ...(!sameDay ? {year: 'numeric', month: '2-digit', day: '2-digit'} as const : {})})}`;
        this.timeSummary.setAttribute('aria-label', `${this.labels.details}: ${date.toLocaleString(locale)}`);
        for (const item of [primary, ...details].filter(valid)) {
            const label = document.createElement('dt'), value = document.createElement('dd');
            label.textContent = item.label; value.textContent = new Date(item.value).toLocaleString(locale);
            this.timeDetails.append(label, value);
        }
    }
    destroy(): void {this.abort.abort(); this.element.remove();}
}
