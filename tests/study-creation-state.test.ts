import {expect, it} from 'vitest';
import {CreationState} from '../src/study/creation-state';

it('retains pending identity from the host contract regardless of diagnostic code', () => {
    const state = new CreationState(() => 'draft');
    state.begin('original');
    state.fail({code: 'OTHER_HOST_WAITING', recovery: 'pending'});
    expect(state.pendingOperation).toBe('original');
    state.fail({code: 'TEXT_RESULT_NOT_ACTUALLY_PENDING'});
    expect(state.pendingOperation).toBeUndefined();
});
it('rejects stale generation observations after starting another operation or document', () => {
    let sequence = 0;
    const state = new CreationState(() => `draft-${++sequence}`);
    state.begin('first'); state.begin('second');
    expect(state.accepts('draft-1', 'first')).toBe(false);
    expect(state.accepts('draft-1', 'second')).toBe(true);
    state.complete('generated'); state.reset();
    expect(state.accepts('draft-1', 'second')).toBe(false);
    expect(state.pendingOperation).toBeUndefined(); expect(state.generated).toBe('');
    expect(state.draftId).toBe('draft-2');
});
