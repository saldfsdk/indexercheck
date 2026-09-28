export class SourceUnavailableError extends Error {
    sourceType;
    operation;
    constructor(sourceType, operation, cause) {
        const reason = cause instanceof Error ? cause.message : String(cause);
        super(`${sourceType} source unavailable during ${operation}: ${reason}`);
        this.name = "SourceUnavailableError";
        this.sourceType = sourceType;
        this.operation = operation;
    }
}
export function isSourceUnavailableError(error) {
    return error instanceof SourceUnavailableError;
}
//# sourceMappingURL=source.js.map