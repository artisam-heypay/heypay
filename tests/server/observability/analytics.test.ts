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
