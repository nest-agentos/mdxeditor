import {parse, parseFragment, serialize, type DefaultTreeAdapterMap} from 'parse5';

type Element = DefaultTreeAdapterMap['element'];
type Parent = DefaultTreeAdapterMap['parentNode'];
export interface HtmlHandler {id: number; event: string; source: string;}
export interface HtmlDocument {html: string; scripts: string[]; handlers: HtmlHandler[]; blocked: boolean;}
const tags = new Set(('html head body title style div span p a button input textarea select option optgroup label form fieldset legend ' +
    'h1 h2 h3 h4 h5 h6 section article header footer main nav aside ul ol li dl dt dd table thead tbody tfoot tr td th caption colgroup col ' +
    'pre code blockquote b strong i em u s small sub sup br hr details summary dialog progress meter output time figure figcaption img canvas').split(' '));
const attributes = new Set(('lang dir hidden contenteditable spellcheck id class style title role type value name placeholder checked disabled selected multiple readonly required min max step ' +
    'minlength maxlength rows cols width height colspan rowspan scope open tabindex for autocomplete pattern').split(' '));
export const HTML_CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
export const PREVIEW_ID = 'data-html-preview-id';
export function allowedTag(tag: string): boolean {return tags.has(tag.toLowerCase()) && !['html', 'head', 'body'].includes(tag.toLowerCase());}
export function allowedAttribute(name: string, value: string, tag?: string): boolean {
    if (name === 'type' && tag === 'input' && ['file', 'image'].includes(value.toLowerCase())) return false;
    if (name === PREVIEW_ID || name.startsWith('on')) return false;
    return attributes.has(name) || name.startsWith('aria-') || name.startsWith('data-') || name === 'href' && value.startsWith('#');
}

/** Pure parsing never gives authored markup to a live browser document before filtering. */
export function prepareHtmlDocument(source: string, fragment = false): HtmlDocument {
    if (source.length > 1_000_000) throw new Error('HTML_DOCUMENT_TOO_LARGE');
    const tree = fragment ? parseFragment(source) : parse(source);
    const result: HtmlDocument = {html: '', scripts: [], handlers: [], blocked: false};
    let next = 0;
    const visit = (parent: Parent) => {
        parent.childNodes = parent.childNodes.filter(node => {
            if (!('tagName' in node)) return node.nodeName === '#text' || node.nodeName === '#documentType';
            const id = ++next; if (next > 10_000) throw new Error('HTML_NODE_LIMIT');
            if (node.tagName === 'meta' && !node.attrs.some(attr => attr.name === 'http-equiv')) return false;
            if (node.tagName === 'script') {extractScript(node, result); return false;}
            if (!tags.has(node.tagName)) {result.blocked = true; return false;}
            filterAttributes(node, id, result); visit(node); return true;
        });
    };
    visit(tree); result.html = serialize(tree); return result;
}

function extractScript(node: Element, result: HtmlDocument): void {
    const type = node.attrs.find(attr => attr.name === 'type')?.value.toLowerCase();
    if (node.attrs.some(attr => attr.name === 'src') || type && !['text/javascript', 'application/javascript'].includes(type)) {
        result.blocked = true; return;
    }
    if (result.scripts.length >= 100) throw new Error('HTML_SCRIPT_LIMIT');
    result.scripts.push(node.childNodes.map(node => 'value' in node ? node.value : '').join(''));
}
function filterAttributes(node: Element, id: number, result: HtmlDocument): void {
    node.attrs = node.attrs.filter(attr => {
        if (attr.name.startsWith('on')) {result.handlers.push({id, event: attr.name.slice(2), source: attr.value}); return false;}
        const allowed = allowedAttribute(attr.name, attr.value, node.tagName); if (!allowed) result.blocked = true; return allowed;
    });
    node.attrs.push({name: PREVIEW_ID, value: String(id)});

}
