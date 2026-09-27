import { describe, it, expect, vi, afterEach } from "vitest";

// analytics reads its env at module load, so each case stubs the env and
// re-imports the module fresh.
async function loadFresh(key?: string, host?: string) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", key ?? "");
  vi.stubEnv("POSTHOG_HOST", host ?? "");
  return import("@/server/observability/analytics");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("captureEvent", () => {
  it("sends nothing without a key", async () => {
    const { captureEvent, analyticsEnabled } = await loadFresh();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    captureEvent("payment_status_changed", "user-1", { to_status: "SETTLED" });
    await new Promise((r) => setTimeout(r, 0));

    expect(analyticsEnabled()).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts the event to the configured host's capture endpoint", async () => {
    const { captureEvent, analyticsEnabled } = await loadFresh(
      "phc_test",
      "https://eu.i.posthog.com/",
    );
    const fetchSpy = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    captureEvent("payment_status_changed", "user-1", { to_status: "SETTLED", amount_php: 150 });
    await new Promise((r) => setTimeout(r, 0));

    expect(analyticsEnabled()).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://eu.i.posthog.com/i/v0/e/");
    expect(JSON.parse(init.body as string)).toMatchObject({
      api_key: "phc_test",
      event: "payment_status_changed",
      distinct_id: "user-1",
      properties: { to_status: "SETTLED", amount_php: 150 },
    });
  });

  it("never throws even if the send rejects", async () => {
    const { captureEvent } = await loadFresh("phc_test");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => captureEvent("x", "user-1")).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));

    expect(errSpy).toHaveBeenCalledWith(
      "[analytics] failed to ship to posthog",
      expect.objectContaining({ error: "network down" }),
    );
  });
});

describe("captureUserEvent", () => {
  it("sends payer and merchant events with their role", async () => {
    const { captureUserEvent } = await loadFresh("phc_test");
    const fetchSpy = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    captureUserEvent("payment_quoted", { id: "payer-1", role: "PAYER" }, { amount_php: 10 });
    captureUserEvent("merchant_went_live", { id: "merchant-1", role: "MERCHANT" });
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const bodies = fetchSpy.mock.calls.map(([, init]) =>
      JSON.parse((init as RequestInit).body as string),
    );
    expect(bodies[0]).toMatchObject({
      distinct_id: "payer-1",
      properties: { role: "PAYER", amount_php: 10 },
    });
    expect(bodies[1]).toMatchObject({
      distinct_id: "merchant-1",
      properties: { role: "MERCHANT" },
    });
  });

  it("never sends admin activity", async () => {
    const { captureUserEvent } = await loadFresh("phc_test");
    const fetchSpy = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    captureUserEvent("user_logged_in", { id: "admin-1", role: "ADMIN" });
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("normalizeApiPath", () => {
  it("replaces id segments so paths group together", async () => {
    const { normalizeApiPath } = await loadFresh();
    expect(normalizeApiPath("/api/payments/cmg1abcdefghijklmnopqrst/confirm")).toBe(
      "/api/payments/:id/confirm",
    );
    expect(normalizeApiPath("/api/payments/0b6f1c2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e")).toBe(
      "/api/payments/:id",
    );
    expect(normalizeApiPath("/api/wallet/deposit-address")).toBe("/api/wallet/deposit-address");
  });
});
