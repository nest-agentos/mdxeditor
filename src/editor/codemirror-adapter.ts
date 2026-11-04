// @mdx/editor/codemirror-adapter.ts
import { EditorState, Extension, Facet, Compartment, StateEffect, StateField } from '@codemirror/state';
import { EditorView, Decoration, DecorationSet } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { search } from '@codemirror/search';
import type {LanguageSupport} from '@codemirror/language';
import {codeLanguage, type CodeLanguageRequest} from './code-language';
import {randomUUID} from '../utils/random';
import {log} from '../utils/logger';

/**
 * CodeMirror 适配器
 * 
 * 职责：封装所有 CodeMirror 6 的直接依赖
 * 原则：编辑器其他模块只通过此适配器与 CM 交互
 * 好处：如果将来更换编辑器引擎，只需替换此文件
 */
export interface EditorChangeEvent {
    isUserEvent: boolean;
    docChanged: boolean;
}

export interface ScrollTarget {
    pos: number;
    yMargin?: number;
    center?: boolean;
}

// 导航高亮效果定义 (从 editor.ts 中提取)
const addHighlightEffect = StateEffect.define<{ from: number; to: number }>();
const clearHighlightEffect = StateEffect.define<null>();
const headingHighlightMark = Decoration.mark({
    class: 'cm-heading-navigation-highlight',
    attributes: { 'data-highlight-type': 'navigation' }
});

const navigationHighlightField = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(decorations, tr) {
        decorations = decorations.map(tr.changes);
        for (const effect of tr.effects) {
            if (effect.is(addHighlightEffect)) {
                const { from, to } = effect.value;
                decorations = decorations.update({ add: [headingHighlightMark.range(from, to)] });
            } else if (effect.is(clearHighlightEffect)) {
                decorations = Decoration.none;
            }
        }
        return decorations;
    },
    provide: (field) => EditorView.decorations.from(field),
});

export const initialLineWrapping = Facet.define<boolean, boolean>({
    combine: values => values[0] ?? false,
});

export class CodeMirrorAdapter {
    private view: EditorView | null = null;
    private readOnlyCompartment = new Compartment();
    private searchCompartment = new Compartment();
    private wrappingCompartment = new Compartment();
    private languageCompartment = new Compartment();
    private languageGeneration = 0;

    /**
     * 创建 EditorView 实例
     */
    create(
        parent: HTMLElement,
        content: string,
        extensions: Extension[],
        callbacks: {
            onChange: (event: EditorChangeEvent) => void;
            onBlur: () => void;
            onFocus: () => void;
        },
        enableMarkdown = true
    ): void {
        ++this.languageGeneration;
        const allExtensions: Extension[] = [
            ...extensions,
            this.languageCompartment.of(enableMarkdown ? markdown() : []),
            this.readOnlyCompartment.of(EditorView.editable.of(true)),
            this.searchCompartment.of([]),
            this.wrappingCompartment.of([]),
            navigationHighlightField,
            EditorView.domEventHandlers({
                blur: () => { callbacks.onBlur(); },
                focus: () => { callbacks.onFocus(); }
            }),
            EditorView.updateListener.of((update) => {
                if (update.docChanged) {
                    callbacks.onChange({
                        docChanged: true,
                        isUserEvent: update.transactions.some(tr =>
                            tr.isUserEvent('input') || tr.isUserEvent('delete') ||
                            tr.isUserEvent('paste') || tr.isUserEvent('drop')
                        ),
                    });
                }
            }),
        ];

        const initial = EditorState.create({ doc: content, extensions: allExtensions });
        const state = initial.update({ effects: this.wrappingCompartment.reconfigure(
            initial.facet(initialLineWrapping) ? EditorView.lineWrapping : []
        ) }).state;
        this.view = new EditorView({
            state,
            parent,
        });
    }

    getLineWrapping(): boolean {
        return !!this.view && this.wrappingCompartment.get(this.view.state) === EditorView.lineWrapping;
    }

    setLineWrapping(enabled: boolean): void {
        this.view?.dispatch({ effects: this.wrappingCompartment.reconfigure(
            enabled ? EditorView.lineWrapping : []
        ) });
    }

    getText(): string {
        return this.view?.state.doc.toString() ?? '';
    }

    setText(text: string): void {
        if (!this.view) return;
        const current = this.getText();
        if (text === current) return;
        this.view.dispatch({
            changes: { from: 0, to: this.view.state.doc.length, insert: text }
        });
    }

    applyEdit(from: number, to: number, insert: string): void {
        this.view?.dispatch({changes: {from, to, insert}, userEvent: 'input.plugin'});
    }

    setReadOnly(isReadOnly: boolean): void {
        this.view?.dispatch({
            effects: this.readOnlyCompartment.reconfigure(EditorView.editable.of(!isReadOnly))
        });
    }

    focus(): void {
        this.view?.focus();
    }

    getLineAt(pos: number) {
        return this.view?.state.doc.lineAt(pos);
    }

    // --- 导航高亮 ---

    addHighlight(from: number, to: number): void {
        this.view?.dispatch({ effects: addHighlightEffect.of({ from, to }) });
    }

    clearHighlight(): void {
        this.view?.dispatch({ effects: clearHighlightEffect.of(null) });
    }

    scrollTo(target: ScrollTarget): void {
        if (!this.view) return;
        this.view.dispatch({
            selection: { anchor: target.pos },
            effects: EditorView.scrollIntoView(target.pos, {
                y: target.center ? 'center' : 'start',
                yMargin: target.yMargin ?? 100
            }),
        });
    }

    // --- 搜索 ---

    enableSearch(): void {
        this.view?.dispatch({
            effects: this.searchCompartment.reconfigure(search({ top: true }))
        });
    }

    disableSearch(): void {
        this.view?.dispatch({
            effects: this.searchCompartment.reconfigure([])
        });
    }

    /**
     * 获取原始 EditorView（仅供需要深度集成的插件使用）
     * @internal
     */
    getRawView(): EditorView | null {
        return this.view;
    }

    async configureCodeLanguage(request: CodeLanguageRequest, status?: (failed: boolean) => void,
        load?: () => Promise<LanguageSupport>): Promise<void> {
        const generation = ++this.languageGeneration, view = this.view;
        if (!view) return;
        const operationId = randomUUID(), started = performance.now(), language = codeLanguage(request);
        view.dispatch({effects: this.languageCompartment.reconfigure([])});
        try {
            const support = language ? await (load ? load() : language.load()) : undefined;
            if (generation !== this.languageGeneration || this.view !== view) return;
            view.dispatch({effects: this.languageCompartment.reconfigure(support ?? [])}); status?.(false);
            log.debug('language.configure', {operationId, stage: 'apply', result: language ? 'success' : 'skipped',
                code: request.enabled === false ? 'DOCUMENT_SYNTAX_BUDGET' : language ? undefined : 'PLAIN_TEXT',
                language: language?.name, durationMs: Math.round(performance.now() - started)});
        } catch {
            if (generation !== this.languageGeneration || this.view !== view) return;
            status?.(true); log.warn('language.configure', {operationId, stage: 'load', result: 'failure', code: 'LANGUAGE_MODULE_LOAD_FAILED',
                language: language?.name, durationMs: Math.round(performance.now() - started)});
        }
    }

    destroy(): void {
        ++this.languageGeneration;
        this.view?.destroy();
        this.view = null;
    }
}
