import {LanguageDescription} from '@codemirror/language';
import {languages} from '@codemirror/language-data';
import type {EditorOptions} from './contracts';

export type CodeLanguageRequest = Pick<EditorOptions, 'documentPath' | 'language'> & {enabled?: boolean};
const plain = new Set(['text', 'plain', 'plaintext', 'txt']);
const markdown = new Set(['md', 'mdx', 'markdown']);

export function codeLanguage(request: CodeLanguageRequest): LanguageDescription | undefined {
    const explicit = request.language?.replace(/^\./, '').toLowerCase();
    if (request.enabled === false || explicit && plain.has(explicit)) return;
    const selected = explicit && (LanguageDescription.matchLanguageName(languages, explicit, false)
        ?? languages.find(language => language.extensions.includes(explicit)));
    const filename = request.documentPath?.split(/[\\/]/).pop();
    const result = selected || (filename ? LanguageDescription.matchFilename(languages, filename) : undefined);
    return result?.name.toLowerCase() === 'markdown' ? undefined : result ?? undefined;
}

export function inferredTextDocument(options: Pick<EditorOptions, 'documentPath' | 'language'>): boolean {
    if (options.language) return !markdown.has(options.language.replace(/^\./, '').toLowerCase());
    const name = options.documentPath?.split(/[\\/]/).pop() ?? '';
    if (markdown.has(name.split('.').pop()?.toLowerCase() ?? '')) return false;
    return name.includes('.') || !!codeLanguage(options);
}
