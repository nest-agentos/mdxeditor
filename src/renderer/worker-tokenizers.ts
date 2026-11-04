import type { MarkedExtension } from 'marked';
export type WorkerSyntax = 'mdxAiChatAnchor' | 'mdxAiChat' | 'math-display' | 'math-inline' | 'cloze:cloze' | 'mdxLink' | 'mdxTransclusion';
const identities = new WeakMap<Function, WorkerSyntax>();

/**
 * Cloze identity must survive edits, so it derives from content rather than position:
 * `auto-<hash>-<occurrence>`. `legacy()` keeps pre-hash positional ids addressable so review
 * progress written before this change is adopted instead of orphaned.
 */
export interface ClozeIdentity {
    occurrence(content: string): number;
    legacy(): string;
}

/** FNV-1a over authored content; identical on the main thread and inside the lexer worker. */
export function clozeContentHash(content: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < content.length; index++) {
        hash ^= content.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(36);
}

export function clozeLocatorId(content: string, occurrence: number): string {
    return `auto-${clozeContentHash(content)}-${occurrence}`;
}

function defaultClozeIdentity(): ClozeIdentity {
    const occurrences = new Map<string, number>();
    let legacy = 0;
    return {
        occurrence(content) { const seen = occurrences.get(content) ?? 0; occurrences.set(content, seen + 1); return seen; },
        legacy() { return `auto-${legacy++}`; },
    };
}

/** Shared lexical rules: worker tokenization and plugin renderers keep one grammar. */
export function builtinTokenizer(name: WorkerSyntax, cloze?: ClozeIdentity): (src: string) => any {
    const identity = cloze ?? defaultClozeIdentity();
    const tokenize = (src: string): any => {
        if (name === 'mdxAiChatAnchor') {
            const match = /^::@([a-zA-Z0-9_-]{1,128})@/.exec(src);
            return match ? {type: name, raw: match[0], anchorId: match[1], prompt: ''} : undefined;
        }
        if (name === 'mdxAiChat') {
            const match = /^::@(?:[ \t]+([^\r\n]*)|(?=\r?\n|$))(?:\r?\n|$)/.exec(src);
            return match ? { type: name, raw: match[0], prompt: (match[1] ?? '').trim() } : undefined;
        }
        if (name === 'cloze:cloze') {
            const match = src.match(/^--(?:\[([^\]]+)\]\s*)?([\s\S]+?)--(?:\^\^audio:([^^]+)\^\^)?/);
            if (!match) return undefined;
            const content = match[2].trim();
            const authored = match[1];
            return { type: name, raw: match[0], content, audio: match[3]?.trim(),
                locator: authored || clozeLocatorId(content, identity.occurrence(content)),
                legacyLocator: authored ? undefined : identity.legacy() };
        }
        if (name === 'mdxLink') {
            const match = src.match(/^\[([^\]]+)\]\(mdx:\/\/([^/]+)\/([^)]+)\)/);
            return match ? { type: name, raw: match[0], text: match[1], provider: match[2], id: match[3] } : undefined;
        }
        if (name === 'mdxTransclusion') {
            const match = /^!@(\w+):(\S+)(?:\n|$)/.exec(src);
            return match ? { type: name, raw: match[0], providerKey: match[1], id: match[2] } : undefined;
        }
        const match = src.match(name === 'math-display' ? /^\$\$([\s\S]+?)\$\$/ : /^\$([^\$\n]+?)\$/);
        return match ? { type: name, raw: match[0], text: match[1].trim() } : undefined;
    };
    identities.set(tokenize, name);
    return tokenize;
}

export function workerSyntax(extensions: any[]): WorkerSyntax[] {
    const names: WorkerSyntax[] = [];
    for (const extension of extensions) {
        if (extension.tokenizer || extension.hooks?.provideLexer) throw new Error('Custom lexer requires a worker implementation');
        for (const item of extension.extensions ?? []) {
            if (!item.tokenizer) continue;
            const name = identities.get(item.tokenizer);
            if (!name) throw new Error('Custom tokenizer requires a worker implementation');
            names.push(name);
        }
    }
    return names;
}

export function lexicalExtension(name: WorkerSyntax): MarkedExtension {
    return { extensions: [{ name,
        level: name === 'math-display' || name === 'mdxTransclusion' || name === 'mdxAiChat' ? 'block' : 'inline',
        start: src => name === 'mdxAiChatAnchor' ? src.match(/::@[a-zA-Z0-9_-]{1,128}@/)?.index
            : name === 'mdxAiChat' ? src.match(/^::@(?=[ \t]|$)/m)?.index
            : name === 'math-display' ? src.match(/^\$\$/)?.index
            : name === 'math-inline' ? src.match(/\$/)?.index : name === 'cloze:cloze' ? src.match(/--/)?.index
            : name === 'mdxLink' ? src.indexOf('](') : src.match(/!@/)?.index,
        tokenizer: builtinTokenizer(name),
    }] };
}
