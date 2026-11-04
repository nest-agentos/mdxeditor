/** Keep host error details out of diagnostics while retaining stage and safe codes. */
export function studyFailure(error: unknown): { code: string; stage?: string } {
    const value = error && typeof error === 'object' ? error as { code?: unknown; stage?: unknown } : {};
    const code = typeof value.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value.code) ? value.code : 'STUDY_FAILED';
    return { code, stage: typeof value.stage === 'string' ? value.stage : undefined };
}

export async function studyStep<T>(stage: string, action: () => Promise<T>): Promise<T> {
    try { return await action(); }
    catch (cause) {
        const failure = studyFailure(cause);
        throw Object.assign(new Error(stage, { cause }), {
            stage, code: failure.code === 'STUDY_FAILED' ? stage.toUpperCase().replaceAll('-', '_') + '_FAILED' : failure.code,
        });
    }
}
