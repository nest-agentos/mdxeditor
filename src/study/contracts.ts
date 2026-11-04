import type { ScopedPersistenceStore } from '../core/types';
export interface StudyEntry { id: string; title: string; kind: 'directory' | 'document' }
export interface StudyDocument { content: string; revision: string }
/** Notify only after durable commits. Omit document IDs when the affected scope is unknown. */
export type StudyChange = {type: 'progress'; documents?: readonly string[]} | {type: 'sources'};
export interface StudyHost {
    list(parent?: string): Promise<StudyEntry[]>;
    read(id: string): Promise<StudyDocument>;
    store(id: string): ScopedPersistenceStore;
    open(id: string): Promise<void>;
    /** Optional subscription; return cleanup. Source IDs are opaque and host-owned. */
    watch?(listener: (change: StudyChange) => void): () => void;
    creation?: StudyCreation;
    now?: () => number;
    locale?: 'zh-CN' | 'en';
}
export interface StudyCard { document: string; title: string; revision: string; locator: string; legacy?: string; question: string; answer: string }

export interface StudyDraft {operationId: string; title: string; content: string; parent?: StudyEntry}
export interface StudyGenerationRequest {draftId: string; title: string; promptName?: string; onExecution?(execution: {label: string; url: string}): void; modelId?: string; targetId?: string; operationId: string; prompt: string; source: string; previousDraft: string; signal: AbortSignal}
export interface StudyPrompt {id: string; name: string; content: string}
export interface StudyCreationState {
    version: 1; draftId: string; title: string; source: string; prompt: string; content: string; generated: string;
    parent?: StudyEntry; promptName?: string; targetId?: string; modelId?: string;
    tab?: 'source' | 'prompt' | 'result'; pendingOperationId?: string; execution?: {label: string; url: string};
}
/** Host errors may retain an admitted operation for later observation. Codes are diagnostic only. */
export interface StudyGenerationFailure {code: string; recovery?: 'pending'}
export interface StudyGeneration {
    /** Reject with recovery:pending only when the admitted operation may still produce a result. */
    generate(request: StudyGenerationRequest): Promise<string>;
    resume?(request: Pick<StudyGenerationRequest, 'draftId' | 'operationId' | 'signal' | 'onExecution'>): Promise<string>;
    /** AbortSignal stops observation; cancel explicitly requests execution cancellation. */
    cancel?(request: Pick<StudyGenerationRequest, 'draftId' | 'operationId'>): Promise<void>;
    configurationUrl?: string;
    targets?: {list(signal: AbortSignal): Promise<Array<{id: string; label: string; disabled?: boolean; reason?: string; default?: boolean; model?: string; models?: Array<{id: string; label: string}>}>>};
}
export interface StudyPromptOptions {
    presets?: readonly StudyPrompt[];
    defaultPrompt?: string;
    store?: {load(signal: AbortSignal): Promise<string | undefined>; save(prompt: string): Promise<void>;
        list?(signal: AbortSignal): Promise<StudyPrompt[] | undefined>; saveList?(prompts: readonly StudyPrompt[]): Promise<void>};
}
export interface StudyDraftStore {
    load(signal: AbortSignal): Promise<StudyCreationState | undefined>;
    save(state: StudyCreationState): Promise<void>;
    clear(): Promise<void>;
}
export interface StudyDocuments {
    /** Save destinations are independent of the tracked learning sources. IDs stay opaque. */
    directories?: {list(parent?: string, signal?: AbortSignal): Promise<StudyEntry[]>};
    save(draft: StudyDraft): Promise<void | {label: string}>;
}
export interface StudyCreation {
    documents: StudyDocuments;
    generation?: StudyGeneration;
    prompts?: StudyPromptOptions;
    recovery?: StudyDraftStore;
    sources?: {search(query: string, signal: AbortSignal, parent?: string): Promise<Array<{id: string; label: string; kind?: 'directory' | 'document'}>>; read(id: string, signal: AbortSignal): Promise<string>};
    label?: string;
}
