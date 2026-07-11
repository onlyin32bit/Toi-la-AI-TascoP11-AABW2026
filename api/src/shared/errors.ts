export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "UNSUPPORTED_SOURCE"
  | "SOURCE_ACCESS_DENIED"
  | "SOURCE_TOO_LARGE"
  | "PROCESSING_FAILED"
  | "AI_OUTPUT_INVALID"
  | "VECTOR_INDEX_UNAVAILABLE"
  | "DATABASE_ERROR"
  | "INTERNAL_ERROR";

export interface ErrorDetail {
  path: string;
  message: string;
}

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: number,
    public readonly details: ErrorDetail[] = [],
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFound = (entity: string) =>
  new AppError("NOT_FOUND", `${entity} was not found.`, 404);
