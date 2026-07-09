/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { HealthTiles } from "@/components/admin/HealthTiles";

const initial = {
  status: "degraded" as const,
  checkedAt: "2026-06-28T00:00:00.000Z",
  components: [
    { name: "stellar" as const, status: "ok" as const, detail: "Horizon 200", latencyMs: 42 },
    { name: "pdax" as const, status: "ok" as const, detail: "mock rail" },
    { name: "redis" as const, status: "ok" as const, detail: "PONG", latencyMs: 1 },
    { name: "queue" as const, status: "degraded" as const, detail: "failed 2", queueDepth: 7 },
  ],
};

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi
      .fn()
      .mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(initial), { status: 200 })),
  );
});

describe("HealthTiles", () => {
  it("renders a tile per component with status and queue depth", () => {
    render(<HealthTiles initial={initial} />);
    expect(screen.getByText("stellar")).toBeInTheDocument();
    expect(screen.getByText("pdax")).toBeInTheDocument();
    expect(screen.getByText("redis")).toBeInTheDocument();
    expect(screen.getByText("queue")).toBeInTheDocument();
    expect(screen.getByText(/Queue depth: 7/)).toBeInTheDocument();
  });
});
