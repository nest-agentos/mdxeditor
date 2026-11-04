import type {StudyText} from './locale';
import {element, studyButton} from './dom';
import {progressSeries, type ProgressDocument, type ProgressPoint, type ProgressRange} from './progress-data';
export interface ChartSettings {range: ProgressRange; mode: 'coverage' | 'activity'}
const NS = 'http://www.w3.org/2000/svg';
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string>): SVGElementTagNameMap[K] {
    const node = document.createElementNS(NS, tag); for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value); return node;
}
export function progressChart(documents: ProgressDocument[], now: number, w: StudyText, locale: string,
    settings: ChartSettings = {range: 30, mode: 'coverage'}): HTMLElement {
    const root = element('section', 'mdx-study__chart'), content = element('div');
    const heading = element('div', 'mdx-study__chart-heading'); heading.append(element('h4', '', w('progressTitle')));
    const ranges = element('div', 'mdx-study__chart-controls'), modes = element('div', 'mdx-study__chart-controls');
    const buttons: Array<{button: HTMLButtonElement; active: () => boolean}> = [];
    const add = (container: HTMLElement, label: string, apply: () => void, active: () => boolean) => {
        const button = studyButton(label, () => {apply(); render();}, 'chart'); buttons.push({button, active}); container.append(button);
    };
    for (const range of [7, 30, 'all'] as const) add(ranges, range === 'all' ? w('allTime') : range + ' ' + w('days'), () => {settings.range = range;}, () => settings.range === range);
    for (const mode of ['coverage', 'activity'] as const) add(modes, w(mode), () => {settings.mode = mode;}, () => settings.mode === mode);
    heading.append(ranges); root.append(heading, modes, content);
    function render(): void {
        for (const {button, active} of buttons) button.setAttribute('aria-pressed', String(active()));
        const points = progressSeries(documents, settings.range, now); content.replaceChildren();
        if (!points.length) {content.append(element('p', 'mdx-study__hint', w('none'))); return;}
        renderPlot(content, points, documents, settings.mode, w, locale);
    }
    render(); return root;
}
function renderPlot(container: HTMLElement, points: ProgressPoint[], documents: ProgressDocument[], mode: ChartSettings['mode'], w: StudyText, locale: string): void {
    const activity = mode === 'activity', max = activity ? Math.max(2, Math.ceil(Math.max(...points.map(point => point.answers)) / 2) * 2) : 100;
    const plot = svg('svg', {viewBox: '0 0 720 210', role: 'img', 'aria-label': w(mode)});
    const x = (index: number) => points.length === 1 ? 380 : 48 + index / (points.length - 1) * 648;
    const value = (point: ProgressPoint) => activity ? point.answers : point.total ? point.learned / point.total * 100 : 0;
    const y = (point: ProgressPoint) => 172 - value(point) / max * 148;
    grid(plot, max, activity);
    if (activity) points.forEach((point, index) => plot.append(svg('rect', {x: String(x(index) - Math.min(12, 250 / points.length)), y: String(y(point)),
        width: String(Math.min(24, 500 / points.length)), height: String(172 - y(point)), rx: '2', class: 'mdx-study__chart-bar'})));
    else drawLines(plot, points, x, y, documents.length);
    const focus = svg('circle', {cx: String(x(points.length - 1)), cy: String(y(points.at(-1)!)), r: '5', class: 'mdx-study__chart-focus'}); plot.append(focus);
    const dates = element('div', 'mdx-study__chart-dates'); dates.append(element('span', '', date(points[0]!.from, locale)), element('span', '', date(points.at(-1)!.at, locale)));
    const output = element('output', 'mdx-study__chart-output'); output.setAttribute('aria-live', 'polite');
    const slider = element('input', 'mdx-study__chart-slider'); slider.type = 'range'; slider.min = '0'; slider.max = String(points.length - 1); slider.value = slider.max;
    slider.setAttribute('aria-label', w('inspectDate')); slider.disabled = points.length === 1;
    const select = (index: number) => {const point = points[index]!; slider.value = String(index); focus.setAttribute('cx', String(x(index))); focus.setAttribute('cy', String(y(point))); describe(output, slider, point, documents.length, w, locale);};
    slider.oninput = () => select(Number(slider.value));
    plot.onpointermove = event => {const rect = plot.getBoundingClientRect(), fraction = ((event.clientX - rect.left) / rect.width * 720 - 48) / 648; select(Math.max(0, Math.min(points.length - 1, Math.round(fraction * (points.length - 1)))));};
    select(points.length - 1); container.append(plot, dates, slider, output);
    const recorded = documents.filter(document => document.events.length).length;
    container.append(element('p', 'mdx-study__hint mdx-study__chart-note', recorded ? `${w('recordedFiles')} ${recorded}/${documents.length} · ${w('historyHint')}` : w('noHistory')));
}
function drawLines(plot: SVGSVGElement, points: ProgressPoint[], x: (index: number) => number, y: (point: ProgressPoint) => number, documents: number): void {
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]!, b = points[i]!;
        plot.append(svg('line', {x1: String(x(i - 1)), y1: String(y(a)), x2: String(x(i)), y2: String(y(b)),
            class: 'mdx-study__chart-line', 'stroke-dasharray': a.known < documents || b.known < documents || a.total !== b.total || b.changed ? '5 5' : 'none'}));
    }
    points.forEach((point, index) => plot.append(svg('circle', {cx: String(x(index)), cy: String(y(point)), r: point.changed ? '5' : '2.5',
        class: point.changed ? 'mdx-study__chart-change' : 'mdx-study__chart-dot'})));
}
function grid(plot: SVGSVGElement, max: number, activity: boolean): void {
    for (const ratio of [0, .5, 1]) {
        const y = String(172 - ratio * 148); plot.append(svg('line', {x1: '48', x2: '696', y1: y, y2: y, class: 'mdx-study__chart-grid'}));
        const label = svg('text', {x: '38', y: String(Number(y) + 4), 'text-anchor': 'end', class: 'mdx-study__chart-label'});
        label.textContent = activity ? Number((ratio * max).toFixed(1)).toString() : Math.round(ratio * 100) + '%'; plot.append(label);
    }
}
function date(at: number, locale: string): string {return new Date(at).toLocaleDateString(locale, {year: 'numeric', month: 'short', day: 'numeric'});}
function describe(output: HTMLOutputElement, slider: HTMLInputElement, point: ProgressPoint, documents: number, w: StudyText, locale: string): void {
    const percentage = point.total ? Math.round(point.learned / point.total * 100) : 0;
    const label = date(point.from, locale) === date(point.at, locale) ? date(point.at, locale) : `${date(point.from, locale)} – ${date(point.at, locale)}`;
    output.textContent = `${label} · ${w(point.current ? 'current' : 'learned')} ${point.learned}/${point.total} (${percentage}%) · ${w('answersInPeriod')} ${point.answers} · ${w(point.current ? 'scopeFiles' : 'recordedFiles')} ${point.known}/${documents}${point.changed ? ' · ' + w('cardsChanged') : ''}`;
    slider.setAttribute('aria-valuetext', output.textContent);
}
