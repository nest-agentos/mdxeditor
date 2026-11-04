// @vitest-environment jsdom
import {afterEach, expect, it, vi} from 'vitest';
import {language as activeLanguage, type LanguageSupport} from '@codemirror/language';
import {codeLanguage} from '../src/editor/code-language';
import {documentProfile} from '../src/editor/document-policy';
import {CodeMirrorAdapter} from '../src/editor/codemirror-adapter';
import {log} from '../src/utils/logger';

const adapters: CodeMirrorAdapter[] = [];
afterEach(() => {for (const adapter of adapters.splice(0)) adapter.destroy(); document.body.replaceChildren(); vi.restoreAllMocks();});
function fixture(text = 'const value = 1') {
    const host = document.createElement('div'); document.body.append(host);
    const adapter = new CodeMirrorAdapter(), change = vi.fn(); adapters.push(adapter);
    adapter.create(host, text, [], {onChange: change, onBlur() {}, onFocus() {}}, false);
    return {adapter, change, view: adapter.getRawView()!};
}
it.each(['a.ts', 'a.tsx', 'a.js', 'a.jsx', 'a.json', 'a.py', 'a.rs', 'a.cpp', 'a.java', 'a.yaml', 'a.sql', 'a.sh', 'Dockerfile'])(
    'selects a lazy language description and source mode for %s', documentPath => {
        const language = codeLanguage({documentPath}); expect(language).toBeDefined();
        expect(documentProfile({documentPath}, 'small')).toMatchObject({format: 'text', initialMode: 'edit', enableMarkdown: false});
    });
it('honors explicit languages, plaintext, host Markdown aliases and the existing large-document budget', () => {
    expect(codeLanguage({documentPath: 'a.py', language: '.ts'})?.name).toBe('TypeScript');
    expect(codeLanguage({documentPath: 'a.ts', language: 'plaintext'})).toBeUndefined();
    expect(codeLanguage({documentPath: 'a.unknown'})).toBeUndefined();
    expect(documentProfile({documentPath: 'a.ts', contentFormat: 'markdown'}, 'small').format).toBe('markdown');
    expect(documentProfile({documentPath: 'a.md'}, 'small').enableMarkdown).toBe(true);
    expect(documentProfile({documentPath: 'a.ts'}, 'x'.repeat(10_001)).largeReason).toBe('line-length');
});
it('loads real parsers without changing source, selection or emitting an edit', async () => {
    const f = fixture(); f.view.dispatch({selection: {anchor: 6}}); const change = f.change.mock.calls.length;
    const support = await codeLanguage({documentPath: 'a.ts'})!.load();
    await f.adapter.configureCodeLanguage({documentPath: 'a.ts'});
    expect(f.view.state.facet(activeLanguage)).toBe(support.language);
    expect(f.view.state.doc.toString()).toBe('const value = 1'); expect(f.view.state.selection.main.anchor).toBe(6);
    expect(f.change).toHaveBeenCalledTimes(change);
});
it('ignores stale and destroyed language loads and does not load parsers outside the syntax budget', async () => {
    const f = fixture(); let finish!: (support: LanguageSupport) => void;
    const pending = f.adapter.configureCodeLanguage({language: 'ts'}, undefined, () => new Promise(resolve => {finish = resolve;}));
    await f.adapter.configureCodeLanguage({language: 'python'}); const current = f.view.state.facet(activeLanguage);
    finish(await codeLanguage({language: 'ts'})!.load()); await pending; expect(f.view.state.facet(activeLanguage)).toBe(current);
    const loader = vi.fn(), status = vi.fn(); await f.adapter.configureCodeLanguage({language: 'ts', enabled: false}, status, loader);
    expect(loader).not.toHaveBeenCalled(); expect(f.view.state.facet(activeLanguage)).toBeNull();
    const retired = f.adapter.configureCodeLanguage({language: 'ts'}, status, () => new Promise(resolve => {finish = resolve;}));
    const calls = status.mock.calls.length; f.adapter.destroy(); finish(await codeLanguage({language: 'ts'})!.load()); await retired;
    expect(status).toHaveBeenCalledTimes(calls);
});
it('keeps plain source on module failure, logs safe metadata and supports retry', async () => {
    const f = fixture('PRIVATE_SOURCE'), status = vi.fn(), warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    await f.adapter.configureCodeLanguage({documentPath: 'PRIVATE_PATH.ts'}, status, async () => {throw new Error('PRIVATE_ERROR');});
    expect(status).toHaveBeenLastCalledWith(true); expect(f.view.state.doc.toString()).toBe('PRIVATE_SOURCE');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE');
    expect(warn.mock.calls[0][1]).toMatchObject({stage: 'load', result: 'failure', code: 'LANGUAGE_MODULE_LOAD_FAILED'});
    await f.adapter.configureCodeLanguage({language: 'ts'}, status); expect(status).toHaveBeenLastCalledWith(false);
    expect(f.view.state.facet(activeLanguage)).not.toBeNull();
});
