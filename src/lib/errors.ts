export type ErrorEnvelope = { error: { code: string; message: string; details?: unknown } };

/** Thrown inside handlers; caught by the API wrapper and rendered as ErrorEnvelope. */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }

  toEnvelope(): ErrorEnvelope {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details !== undefined ? { details: this.details } : {}),
      },
    };
  }
}

export const badRequest = (msg: string, details?: unknown): AppError =>
  new AppError("BAD_REQUEST", msg, 400, details);

export const unauthorized = (msg = "Authentication required."): AppError =>
  new AppError("UNAUTHORIZED", msg, 401);

export const forbidden = (msg = "You do not have access to this resource."): AppError =>
  new AppError("FORBIDDEN", msg, 403);

export const notFound = (msg = "Resource not found."): AppError =>
  new AppError("NOT_FOUND", msg, 404);

export const conflict = (msg: string, details?: unknown): AppError =>
  new AppError("CONFLICT", msg, 409, details);

export const tooManyRequests = (msg = "Too many requests. Please slow down."): AppError =>
  new AppError("TOO_MANY_REQUESTS", msg, 429);

export const serverError = (msg = "Something went wrong."): AppError =>
  new AppError("SERVER_ERROR", msg, 500);
