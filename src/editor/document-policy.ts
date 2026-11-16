import { type EditorOptions } from '../editor/contracts';
import {inferredTextDocument} from './code-language';

function largeDocumentReason(text: string): DocumentProfile['largeReason'] {
    if (text.length > 256 * 1024) return 'bytes';
    let lines = 1, lineStart = 0;
    for (let index = 0; index < text.length; index++) {
        if (text.charCodeAt(index) === 10) {
            if (++lines > 5_000) return 'lines';
            lineStart = index + 1;
        } else if (index - lineStart >= 10_000) return 'line-length';
    }
    return new TextEncoder().encode(text).byteLength > 256 * 1024 ? 'bytes' : undefined;
}

/** The host selects the format; the standalone editor defaults to Markdown. */
export function documentFormat(options: EditorOptions): 'markdown' | 'text' | 'html' {
    if (options.documentPath && options.resolveContentFormat) return options.resolveContentFormat(options.documentPath);
    if (options.contentFormat) return options.contentFormat;
    if (/\.html?$/i.test(options.documentPath ?? '')) return 'html';
    if (/\.(md|markdown|mdx)$/i.test(options.documentPath ?? '')) return 'markdown';
    return inferredTextDocument(options) || options.documentPath && !options.language ? 'text' : 'markdown';
}

export interface DocumentProfile {
    readonly format: 'markdown' | 'text' | 'html';
    readonly largeReason?: 'bytes' | 'lines' | 'line-length';
    readonly initialMode: 'edit' | 'render';
    readonly enableMarkdown: boolean;
    readonly enableLineWrapping: boolean;
    readonly showSourceNotice: boolean;
}

export function isLargeDocument(text: string): boolean { return largeDocumentReason(text) !== undefined; }

/** Recompute the immutable profile on open and document-path changes. */
export function documentProfile(options: EditorOptions, text: string): DocumentProfile {
    const format = documentFormat(options), largeReason = largeDocumentReason(text);
    return Object.freeze({ format, largeReason,
        initialMode: format === 'text' ? 'edit' : options.initialMode ?? (format === 'html' ? 'render' : 'edit'),
        enableMarkdown: format === 'markdown' && !largeReason,
        enableLineWrapping: !largeReason,
        showSourceNotice: format === 'markdown' && !!largeReason && options.initialMode !== 'render',
    });
}
