import type {StudyEntry} from './contracts';
import type {StudyNode} from './catalog';
import {studyCounts} from './catalog';
import {element, progress, studyButton} from './dom';
import type {StudyText} from './locale';

const refreshers = new WeakMap<HTMLElement, (now: number, documents?: readonly string[]) => void>();
export function refreshStudyList(list: HTMLElement, now: number, documents?: readonly string[]): void {refreshers.get(list)?.(now, documents);}

/** One study list owns scope selection and per-file progress; no extra navigation pane. */
export function studyList(nodes: StudyNode[], selected: Set<string>, now: number, w: StudyText,
    changed: () => void, chart?: (node: StudyNode) => HTMLElement, open?: (id: string) => void, create?: (parent: StudyEntry) => void): HTMLElement {
    const list = element('div', 'mdx-study__list');
    const updates: Array<{node: StudyNode; run(): void}> = [];
    const checks: Array<{node: StudyNode; input: HTMLInputElement}> = [];
    const sync = () => {
        for (const {node, input} of checks) {
            const count = node.documents.filter(id => selected.has(id)).length;
            input.checked = count === node.documents.length; input.indeterminate = count > 0 && !input.checked;
        }
    };
    function append(container: HTMLElement, node: StudyNode, depth: number): void {
        const row = element('div', 'mdx-study__row'); row.dataset.entryId = node.entry.id;
        row.style.setProperty('--study-depth', String(depth));
        const label = element('div', 'mdx-study__file'), check = element('input'); check.type = 'checkbox';
        check.setAttribute('aria-label', node.entry.title); checks.push({node, input: check});
        check.onchange = () => { for (const id of node.documents) check.checked ? selected.add(id) : selected.delete(id); sync(); changed(); };
        const title = node.entry.kind === 'document' && open
            ? fileLink(node, open) : element('span', 'mdx-study__filename', node.entry.title);
        title.title = node.entry.id;
        label.append(check, title); const stats = details(node, now, w); row.append(label, stats); container.append(row);
        if (create && node.entry.kind === 'directory') {
            const add = studyButton(w('newHere'), () => create(node.entry), 'quiet');
            add.setAttribute('aria-label', w('newHere') + ': ' + node.entry.title); stats.append(add);
        }
        const refreshChart = chart ? addChart(container, stats, node, chart, w) : undefined;
        updates.push({node, run: () => {
            const buttons = [...stats.querySelectorAll(':scope > button')], fresh = details(node, now, w);
            stats.replaceChildren(...fresh.childNodes, ...buttons); refreshChart?.();
        }});
        if (node.children.length) {
            const children = element('div', 'mdx-study__group'); children.hidden = depth > 0;
            const toggle = studyButton('', () => {
                children.hidden = !children.hidden; toggle.setAttribute('aria-expanded', String(!children.hidden));
                toggle.setAttribute('aria-label', w(children.hidden ? 'expand' : 'collapse') + ': ' + node.entry.title);
            }, 'expand');
            toggle.setAttribute('aria-expanded', String(!children.hidden)); toggle.setAttribute('aria-label', w(children.hidden ? 'expand' : 'collapse') + ': ' + node.entry.title);
            toggle.innerHTML = '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m7 4 6 6-6 6"/></svg>';
            row.prepend(toggle); container.append(children); node.children.forEach(child => append(children, child, depth + 1));
        }
    }
    nodes.forEach(node => append(list, node, 0)); sync();
    refreshers.set(list, (time, documents) => {
        now = time;
        const selected = documents ? new Set(documents) : undefined;
        for (const {node, run} of updates) if (!selected || node.documents.some(id => selected.has(id))) run();
    });
    return list;
}
function fileLink(node: StudyNode, open: (id: string) => void): HTMLButtonElement {
    const button = element('button', 'mdx-study__filename mdx-study__file-link', node.entry.title);
    button.type = 'button'; button.onclick = () => open(node.entry.id); return button;
}
function details(node: StudyNode, now: number, w: StudyText): HTMLElement {
    const counts = studyCounts(node.items, now), box = element('div', 'mdx-study__file-stats');
    const state = !counts.learned ? 'notStarted' : counts.due ? 'due' : counts.learned === counts.total ? 'allLearned' : 'inProgress';
    const badge = element('span', 'mdx-study__badge', w(state)); badge.dataset.state = state;
    const numbers = element('span', 'mdx-study__counts');
    for (const key of ['total', 'learned', 'fresh', 'due'] as const) {
        const count = element('span', 'mdx-study__count', `${w(key)} ${counts[key]}`); count.dataset.kind = key; numbers.append(count);
    }
    box.append(badge, numbers, progress(counts.learned, counts.total, `${w('learned')} ${counts.learned}/${counts.total}`)); return box;
}

function addChart(container: HTMLElement, controls: HTMLElement, node: StudyNode, chart: (node: StudyNode) => HTMLElement, w: StudyText): () => void {
    const panel = element('div', 'mdx-study__inline-chart'); panel.hidden = true;
    const button = studyButton(w('viewProgress'), () => {
        panel.hidden = !panel.hidden; button.setAttribute('aria-expanded', String(!panel.hidden));
        button.textContent = w(panel.hidden ? 'viewProgress' : 'hideProgress');
        if (!panel.hidden && !panel.childElementCount) panel.append(chart(node));
    }, 'quiet');
    button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-label', w('viewProgress') + ': ' + node.entry.title);
    controls.append(button); container.append(panel);
    return () => {if (!panel.hidden) panel.replaceChildren(chart(node));};
}
