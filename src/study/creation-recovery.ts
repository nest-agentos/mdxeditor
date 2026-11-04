import type {StudyDraftStore, StudyCreationState} from './contracts';
import {studyFailure} from './operations';
import {randomUUID} from '../utils/random';

/** Coalesce input checkpoints; explicit discard is ordered after any in-flight write. */
export class CreationRecovery {
    private pending?: StudyCreationState;
    private tail?: Promise<void>;
    private closed = false;
    constructor(private store: StudyDraftStore, private report: (ok: boolean) => void) {}
    save(state: StudyCreationState): void {
        if (this.closed) return; this.pending = state;
        this.tail ??= this.drain().finally(() => {this.tail = undefined; if (this.pending) this.save(this.pending);});
    }
    private async drain(): Promise<void> {
        while (this.pending && !this.closed) {
            const value = this.pending; this.pending = undefined; const started = Date.now(), operationId = randomUUID();
            try {await this.store.save(value); if (!this.closed) this.report(true);}
            catch (error) {if (!this.closed) this.report(false); console.warn('[StudyDraft]', {operationId, stage: 'checkpoint', result: 'failure', code: studyFailure(error).code, durationMs: Date.now() - started});}
        }
    }
    async flush(): Promise<void> {while (this.tail) await this.tail;}
    async clear(close = false): Promise<boolean> {
        this.closed = close; this.pending = undefined; await this.flush();
        try {await this.store.clear(); return true;}
        catch (error) {this.report(false); console.warn('[StudyDraft]', {operationId: randomUUID(), stage: 'discard', result: 'failure', code: studyFailure(error).code}); return false;}
    }
}
