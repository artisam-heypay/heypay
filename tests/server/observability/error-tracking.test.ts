import { describe, it, expect, vi, afterEach } from "vitest";

// error-tracking reads SENTRY_DSN at module load, so each case stubs the env and
// re-imports the module fresh.
async function loadFresh(dsn?: string) {
  vi.resetModules();
  if (dsn === undefined) vi.stubEnv("SENTRY_DSN", "");
  else vi.stubEnv("SENTRY_DSN", dsn);
  return import("@/server/observability/error-tracking");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("captureException", () => {
  it("returns a 32-char hex event id and logs, without a DSN configured", async () => {
    const { captureException, errorTrackingEnabled } = await loadFresh(undefined);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const id = captureException(new Error("boom"), { paymentId: "p1" });

    expect(errorTrackingEnabled()).toBe(false);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ships a Sentry envelope to the DSN endpoint when configured", async () => {
    const { captureException, errorTrackingEnabled } = await loadFresh(
      "https://pub123@o1.ingest.sentry.io/456",
    );
    const fetchSpy = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const id = captureException(new Error("kaboom"), { source: "test" });
    // allow the fire-and-forget send to run
    await new Promise((r) => setTimeout(r, 0));

    expect(errorTrackingEnabled()).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://o1.ingest.sentry.io/api/456/envelope/");
    expect((init.headers as Record<string, string>)["X-Sentry-Auth"]).toContain(
      "sentry_key=pub123",
    );
    // envelope: 3 newline-delimited JSON lines (header, item header, event)
    const lines = (init.body as string).trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]!)).toMatchObject({ event_id: id });
    expect(JSON.parse(lines[2]!)).toMatchObject({
      exception: { values: [{ type: "Error", value: "kaboom" }] },
    });
  });

  it("never throws even if the Sentry send rejects", async () => {
    const { captureException } = await loadFresh("https://pub@o1.ingest.sentry.io/9");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => captureException("string error")).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });
});
