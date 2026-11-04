export function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag); node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}
export function studyButton(label: string, action: () => void, variant = ''): HTMLButtonElement {
    const node = element('button', 'mdx-study__button' + (variant ? ' mdx-study__button--' + variant : ''), label);
    node.type = 'button'; node.onclick = action; return node;
}
export function progress(value: number, total: number, label: string): HTMLProgressElement {
    const node = element('progress', 'mdx-study__progress'); node.max = total || 1; node.value = value;
    node.setAttribute('aria-label', label); return node;
}
