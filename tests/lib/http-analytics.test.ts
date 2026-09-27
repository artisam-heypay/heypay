import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const captureUserEvent = vi.fn();
vi.mock("@/server/observability/analytics", async (orig) => ({
  ...(await orig<typeof import("@/server/observability/analytics")>()),
  analyticsEnabled: () => true,
  captureUserEvent: (...args: unknown[]) => captureUserEvent(...args),
}));

const sessionUser = vi.fn();
vi.mock("@/server/auth/sessions", () => ({ getSessionUser: () => sessionUser() }));

const { route } = await import("@/lib/http");
const { conflict, unauthorized } = await import("@/lib/errors");

function call(path: string, err: Error) {
  const handler = route(async () => {
    throw err;
  });
  return handler(new NextRequest(`http://localhost${path}`, { method: "POST" }), {
    params: Promise.resolve({}),
  });
}

describe("route api_error reporting", () => {
  beforeEach(() => {
    captureUserEvent.mockReset();
    sessionUser.mockReset();
  });

  it("reports a failed payer call with a normalized path", async () => {
    sessionUser.mockResolvedValue({ id: "payer-1", role: "PAYER" });

    const res = await call(
      "/api/payments/cmg1abcdefghijklmnopqrst/confirm",
      conflict("quote expired"),
    );

    expect(res.status).toBe(409);
    expect(captureUserEvent).toHaveBeenCalledWith(
      "api_error",
      { id: "payer-1", role: "PAYER" },
      expect.objectContaining({
        path: "/api/payments/:id/confirm",
        status: 409,
        code: "CONFLICT",
        message: "quote expired",
      }),
    );
  });

  it("reports a failed admin call", async () => {
    sessionUser.mockResolvedValue({ id: "admin-1", role: "ADMIN" });

    await call("/api/admin/payments/cmg1abcdefghijklmnopqrst/refund", conflict("not refundable"));

    expect(captureUserEvent).toHaveBeenCalledWith(
      "api_error",
      { id: "admin-1", role: "ADMIN" },
      expect.objectContaining({ path: "/api/admin/payments/:id/refund", status: 409 }),
    );
  });

  it("ignores webhooks, unauthenticated calls and signed-out users", async () => {
    sessionUser.mockResolvedValue(null);

    await call("/api/webhooks/xendit", conflict("x"));
    await call("/api/wallet", unauthorized());
    await call("/api/wallet", conflict("x"));

    expect(captureUserEvent).not.toHaveBeenCalled();
  });

  it("keeps the error response when the session lookup fails", async () => {
    sessionUser.mockRejectedValue(new Error("db down"));

    const res = await call("/api/merchant/qrph", conflict("duplicate"));

    expect(res.status).toBe(409);
    expect(captureUserEvent).not.toHaveBeenCalled();
  });
});
