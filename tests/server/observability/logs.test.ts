import { describe, it, expect, vi, afterEach } from "vitest";

// logs reads its env at module load and patches console once, so each case
// stubs the env, restores console and re-imports the module fresh.
const realConsole = { ...console };

async function loadFresh(key?: string) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", key ?? "");
  vi.stubEnv("POSTHOG_HOST", "https://eu.i.posthog.com/");
  return import("@/server/observability/logs");
}

afterEach(() => {
  Object.assign(console, realConsole);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("toLogRecord", () => {
  it("formats console arguments with an OTLP severity", async () => {
    const { toLogRecord } = await loadFresh();
    expect(toLogRecord("warn", ["[rates] source failed", { code: 1 }], 1_700_000_000_000)).toEqual({
      timeUnixNano: "1700000000000000000",
      severityNumber: 13,
      severityText: "WARN",
      body: { stringValue: "[rates] source failed { code: 1 }" },
    });
  });

  it("truncates very long lines", async () => {
    const { toLogRecord } = await loadFresh();
    expect(toLogRecord("error", ["x".repeat(10_000)]).body.stringValue).toHaveLength(8_001);
  });
});

describe("startLogShipping", () => {
  it("leaves console alone without a key", async () => {
    const { startLogShipping } = await loadFresh();
    const before = console.error;
    startLogShipping("heypay-web");
    expect(console.error).toBe(before);
  });

  it("ships console output under the service name and still prints it", async () => {
    const printed = vi.fn();
    console.info = printed;
    const { startLogShipping, flushLogs } = await loadFresh("phc_test");
    const fetchSpy = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    startLogShipping("heypay-worker");
    console.info("[worker] started", 3);
    await flushLogs();

    expect(printed).toHaveBeenCalledWith("[worker] started", 3);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://eu.i.posthog.com/i/v1/logs");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer phc_test");
    const body = JSON.parse(init.body as string);
    expect(body.resourceLogs[0].resource.attributes).toContainEqual({
      key: "service.name",
      value: { stringValue: "heypay-worker" },
    });
    expect(body.resourceLogs[0].scopeLogs[0].logRecords).toMatchObject([
      { severityText: "INFO", body: { stringValue: "[worker] started 3" } },
    ]);
  });

  it("does not ship its own failure messages", async () => {
    const printedErrors = vi.fn();
    console.error = printedErrors;
    const { startLogShipping, flushLogs } = await loadFresh("phc_test");
    const fetchSpy = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchSpy);

    startLogShipping("heypay-web");
    console.error("boom");
    await flushLogs();
    await flushLogs();

    expect(printedErrors).toHaveBeenCalledWith("[logs] failed to ship to posthog", {
      error: "network down",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
