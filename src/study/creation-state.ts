import type {StudyCreationState, StudyGenerationFailure} from './contracts';

/** Generation identity and recovery transitions are independent of DOM and host error codes. */
export class CreationState {
    draftId: string;
    pendingOperation?: string;
    lastOperation?: string;
    generated = '';
    touched = false;
    constructor(private readonly newId: () => string) {this.draftId = newId();}
    restore(state: StudyCreationState): void {
        this.draftId = state.draftId; this.generated = state.generated;
        this.pendingOperation = state.pendingOperationId; this.touched = true;
    }
    begin(operationId: string): void {this.pendingOperation = operationId; this.lastOperation = operationId;}
    accepts(draftId: string, operationId: string): boolean {return this.draftId === draftId && this.lastOperation === operationId;}
    complete(content: string): void {this.touched = true; this.generated = content; this.pendingOperation = undefined;}
    fail(error: unknown): void {
        if ((error as Partial<StudyGenerationFailure> | null)?.recovery !== 'pending') this.pendingOperation = undefined;
    }
    reset(): void {
        this.draftId = this.newId(); this.pendingOperation = undefined; this.lastOperation = undefined;
        this.generated = ''; this.touched = false;
    }
}
