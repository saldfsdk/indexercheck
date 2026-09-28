export class SourceUnavailableError extends Error {
    sourceType;
    operation;
    cause;
    constructor(sourceType, operation, cause) {
        const reason = cause instanceof Error ? cause.message : String(cause);
        super(`${sourceType} source unavailable during ${operation}: ${reason}`);
        this.name = "SourceUnavailableError";
        this.sourceType = sourceType;
        this.operation = operation;
        this.cause = cause;
    }
}
export function isSourceUnavailableError(error) {
    return error instanceof SourceUnavailableError;
}
//# sourceMappingURL=source.js.map