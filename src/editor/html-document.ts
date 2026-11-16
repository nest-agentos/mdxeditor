import {HTML_CSP, prepareHtmlDocument} from './html-policy';
const escapeAttribute = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');

/** Neither frame permits native scripts. The outer policy also denies child navigations. */
export function htmlPreviewDocument(source: string, _operationId?: string): string {
    return htmlPreviewFrame(prepareHtmlDocument(source).html);
}
export function htmlPreviewFrame(filtered: string): string {
    return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${HTML_CSP}">
<style>html,body{margin:0;height:100%;overflow:hidden}iframe{border:0;width:100%;height:100%;background:white}</style>
<iframe title="HTML" sandbox="allow-same-origin" referrerpolicy="no-referrer" srcdoc="${escapeAttribute(filtered)}"></iframe>`;
}
