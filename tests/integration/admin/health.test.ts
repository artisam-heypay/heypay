import { asAdmin, asPayer, makeRequest, resetDb } from "./helpers";
import { describe, it, expect, beforeEach } from "vitest";
import { GET as DEEP } from "@/app/api/admin/health/route";
import { GET as SHALLOW } from "@/app/api/health/route";

type HealthComponent = { name: string; status: string; queueDepth?: number };

describe("admin health", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("reports a status per component", async () => {
    await asAdmin();
    const res = await DEEP(makeRequest("GET", "/api/admin/health"), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { components: HealthComponent[] };
    const names = body.components.map((c) => c.name).sort();
    expect(names).toEqual(["pdax", "queue", "redis", "stellar"]);
    for (const c of body.components) expect(["ok", "degraded", "down"]).toContain(c.status);
    const queue = body.components.find((c) => c.name === "queue");
    expect(typeof queue?.queueDepth).toBe("number");
  });

  it("requires ADMIN for the deep check", async () => {
    await asPayer();
    const res = await DEEP(makeRequest("GET", "/api/admin/health"), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(403);
  });

  it("public shallow check needs no auth and returns ok", async () => {
    const res = await SHALLOW(makeRequest("GET", "/api/health"));
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("ok");
  });
});
