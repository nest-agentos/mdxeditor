import {headingRecords} from '../utils/heading-records';
import {revealRenderedContent} from '../renderer/reveal-content';
// @mdx/editor/navigation.ts
import { extractHeadings, slugify, tryParseJson, type Heading } from '../utils/markdown';
import { CodeMirrorAdapter } from './codemirror-adapter';

interface HeadingPosition {
    from: number;
    to: number;
    level: number;
    text: string;
}

/**
 * 导航管理器
 * 职责：标题解析缓存 + 编辑器/渲染器内导航 + 高亮生命周期
 */
export class NavigationManager {
    private cmAdapter: CodeMirrorAdapter;
    private headingsCache: { version: number; headings: Heading[] } | null = null;
    private positionsCache: { version: number; positions: Map<string, HeadingPosition> } | null = null;
    private highlightTimer: number | null = null;

    constructor(cmAdapter: CodeMirrorAdapter) {
        this.cmAdapter = cmAdapter;
    }

    // === 标题解析（带版本缓存） ===

    getHeadings(text: string, docVersion: number): Heading[] {
        if (this.headingsCache?.version === docVersion) {
            return this.headingsCache.headings;
        }
        if (tryParseJson(text)) {
            this.headingsCache = { version: docVersion, headings: [] };
            return [];
        }
        const headings = extractHeadings(text, { nested: false });
        this.headingsCache = { version: docVersion, headings };
        return headings;
    }

    /**
     * 获取标题在源码中的位置映射（带缓存）
     */
    private getPositions(text: string, docVersion: number): Map<string, HeadingPosition> {
        if (this.positionsCache?.version === docVersion) {
            return this.positionsCache.positions;
        }

        const positions = new Map<string, HeadingPosition>();

        if (tryParseJson(text)) {
            this.positionsCache = { version: docVersion, positions };
            return positions;
        }

        const counts = new Map<string, number>();
        for (const heading of headingRecords(text)) {
            const base = `heading-${slugify(heading.text)}`, count = counts.get(base) ?? 0;
            counts.set(base, count + 1); positions.set(count ? `${base}-${count}` : base, heading);
        }

        this.positionsCache = { version: docVersion, positions };
        return positions;
    }

    // === 渲染器内导航 ===

    async navigateInRenderer(container: HTMLElement, elementId: string, smooth: boolean): Promise<void> {
        const element = container.querySelector<HTMLElement>(`#${CSS.escape(elementId)}`)
            ?? container.querySelector<HTMLElement>(`#${CSS.escape('heading-' + elementId)}`);
        if (!element) throw new Error('OUTLINE_TARGET_MISSING');
        revealRenderedContent(element, container); element.tabIndex = -1; element.focus({preventScroll: true});
        element.scrollIntoView({behavior: smooth ? 'smooth' : 'instant', block: 'center'});
        this.clearHighlightTimer(); element.classList.add('highlight-pulse');
        this.highlightTimer = window.setTimeout(() => {element.classList.remove('highlight-pulse'); this.highlightTimer = null;}, 1500);
    }

    // === 编辑器内导航 ===

    async navigateInEditor(
        elementId: string,
        text: string,
        docVersion: number,
        isDestroying: boolean
    ): Promise<void> {
        const positions = this.getPositions(text, docVersion);
        let position = positions.get(elementId) ?? positions.get("heading-" + elementId);

        if (!position) {
            throw new Error('OUTLINE_SOURCE_TARGET_MISSING');
        }

        const { from, to } = position;

        // 清理旧高亮
        this.clearHighlightTimer();
        this.cmAdapter.clearHighlight();

        // 滚动到目标
        await this.raf(() => {
            if (isDestroying) return;
            this.cmAdapter.scrollTo({ pos: from, center: true, yMargin: 100 });
        });

        // 添加高亮
        await this.raf(() => {
            if (isDestroying) return;
            this.cmAdapter.addHighlight(from, to);
        });

        this.cmAdapter.focus();

        // 延时清除高亮
        this.highlightTimer = window.setTimeout(() => {
            this.cmAdapter.clearHighlight();
            this.highlightTimer = null;
        }, 2000);
    }

    clearNavigationHighlight(): void {
        this.clearHighlightTimer();
        this.cmAdapter.clearHighlight();
    }

    // === 内部工具 ===

    private raf(fn: () => void): Promise<void> {
        return new Promise(resolve => {
            requestAnimationFrame(() => { fn(); resolve(); });
        });
    }

    private clearHighlightTimer(): void {
        if (this.highlightTimer) {
            clearTimeout(this.highlightTimer);
            this.highlightTimer = null;
        }
    }

    destroy(): void {
        this.clearHighlightTimer();
        this.headingsCache = null;
        this.positionsCache = null;
    }
}
