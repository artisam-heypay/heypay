import { describe, it, expect, vi, afterEach } from "vitest";

// error-tracking reads SENTRY_DSN and NEXT_PUBLIC_POSTHOG_KEY at module load, so
// each case stubs the env and re-imports the module fresh.
async function loadFresh(dsn?: string, posthogKey?: string) {
  vi.resetModules();
  vi.stubEnv("SENTRY_DSN", dsn ?? "");
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", posthogKey ?? "");
  vi.stubEnv("POSTHOG_HOST", "https://us.i.posthog.com");
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

  it("sends a $exception with a parsed stack to PostHog when a key is set", async () => {
    const { captureException, errorTrackingEnabled } = await loadFresh(undefined, "phc_test");
    const fetchSpy = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const id = captureException(new TypeError("cart is undefined"), { source: "settle" });
    await new Promise((r) => setTimeout(r, 0));

    expect(errorTrackingEnabled()).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://us.i.posthog.com/i/v0/e/");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      api_key: "phc_test",
      event: "$exception",
      distinct_id: id,
      properties: {
        source: "settle",
        $exception_level: "error",
        $process_person_profile: false,
      },
    });
    const [exc] = body.properties.$exception_list;
    expect(exc).toMatchObject({ type: "TypeError", value: "cart is undefined" });
    expect(exc.stacktrace.type).toBe("raw");
    expect(exc.stacktrace.frames.length).toBeGreaterThan(0);
  });
});

describe("parseStack", () => {
  it("turns V8 frames into PostHog frames, oldest call first", async () => {
    const { parseStack } = await loadFresh();
    const frames = parseStack(
      [
        "Error: boom",
        "    at settle (/app/src/server/queue/jobs/settle.ts:445:3)",
        "    at /app/node_modules/bullmq/dist/worker.js:10:7",
        "    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)",
      ].join("\n"),
    );

    expect(frames).toHaveLength(3);
    expect(frames[2]).toMatchObject({
      function: "settle",
      filename: "/app/src/server/queue/jobs/settle.ts",
      lineno: 445,
      colno: 3,
      in_app: true,
    });
    expect(frames[1]).toMatchObject({ function: "<anonymous>", in_app: false });
    expect(frames[0]).toMatchObject({ in_app: false });
  });

  it("returns no frames for a missing stack", async () => {
    const { parseStack } = await loadFresh();
    expect(parseStack(undefined)).toEqual([]);
  });
});
