import {Lexer, type Token, type Tokens} from 'marked';
export interface HeadingRecord {text: string; level: number; from: number; to: number}
/** Use the renderer's Markdown grammar, retaining original UTF-16 source positions. */
export function headingRecords(content: string): HeadingRecord[] {
    const result: HeadingRecord[] = [];
    const normalized = content.replace(/\r\n?/g, '\n');
    collect(Lexer.lex(normalized), normalized, 0, result);
    if (normalized === content) return result;
    const offsets: number[] = [];
    for (let original = 0; original < content.length; original++) {
        offsets.push(original); if (content[original] === '\r' && content[original + 1] === '\n') original++;
    }
    offsets.push(content.length);
    return result.map(item => ({...item, from: offsets[item.from], to: offsets[item.to]}));
}
function collect(tokens: readonly Token[], source: string, base: number, output: HeadingRecord[]): void {
    let cursor = 0;
    for (const token of tokens) {
        const at = source.indexOf(token.raw, cursor); if (at < 0) continue;
        if (token.type === 'heading') {
            const heading = token as Tokens.Heading;
            output.push({text: heading.text.replace(/<[^>]*>/g, '').trim(), level: heading.depth,
                from: base + at, to: base + at + token.raw.trimEnd().length});
        } else if (token.type === 'blockquote') collect((token as Tokens.Blockquote).tokens, token.raw, base + at, output);
        else if (token.type === 'list') {
            collectList(token as Tokens.List, base + at, output);
        }
        cursor = at + token.raw.length;
    }
}

function collectList(token: Tokens.List, base: number, output: HeadingRecord[]): void {
    let cursor = 0;
    for (const item of token.items) {
        const at = token.raw.indexOf(item.raw, cursor); if (at < 0) continue;
        collect(item.tokens, item.raw, base + at, output); cursor = at + item.raw.length;
    }
}
