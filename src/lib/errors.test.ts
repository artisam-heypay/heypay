import { describe, it, expect } from "vitest";
import {
  AppError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  tooManyRequests,
  serverError,
} from "./errors";

describe("AppError", () => {
  it("carries code/message/status/details and is an Error", () => {
    const e = new AppError("X_CODE", "boom", 418, { a: 1 });
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe("X_CODE");
    expect(e.message).toBe("boom");
    expect(e.status).toBe(418);
    expect(e.details).toEqual({ a: 1 });
  });
  it("renders an ErrorEnvelope, with and without details", () => {
    expect(new AppError("X", "m", 400, { f: "x" }).toEnvelope()).toEqual({
      error: { code: "X", message: "m", details: { f: "x" } },
    });
    expect(new AppError("X", "m", 400).toEnvelope()).toEqual({
      error: { code: "X", message: "m" },
    });
  });
});

describe("convenience constructors map to correct HTTP statuses", () => {
  it("returns AppError instances with the right status", () => {
    expect(badRequest("b")).toBeInstanceOf(AppError);
    expect(badRequest("b").status).toBe(400);
    expect(unauthorized().status).toBe(401);
    expect(forbidden().status).toBe(403);
    expect(notFound().status).toBe(404);
    expect(conflict("c").status).toBe(409);
    expect(tooManyRequests().status).toBe(429);
    expect(serverError().status).toBe(500);
  });
  it("badRequest and conflict carry details", () => {
    expect(badRequest("b", { field: "x" }).details).toEqual({ field: "x" });
    expect(conflict("c", { id: "1" }).details).toEqual({ id: "1" });
  });
});
