import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { z } from "zod";
import { route, json, parseBody, parseQuery } from "./http";
import { notFound } from "./errors";

function req(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(new Request(url, init));
}

const jsonInit = (body: string): RequestInit => ({
  method: "POST",
  body,
  headers: { "content-type": "application/json" },
});

describe("json", () => {
  it("returns a NextResponse with status + body", async () => {
    const res = json({ ok: true }, 201);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("parseBody", () => {
  const schema = z.object({ amount: z.number() });
  it("returns parsed data on a valid body", async () => {
    const r = req("http://localhost/api/x", jsonInit(JSON.stringify({ amount: 5 })));
    await expect(parseBody(r, schema)).resolves.toEqual({ amount: 5 });
  });
  it("throws badRequest (400) on a schema-invalid body", async () => {
    const r = req("http://localhost/api/x", jsonInit(JSON.stringify({ amount: "no" })));
    await expect(parseBody(r, schema)).rejects.toMatchObject({ code: "BAD_REQUEST", status: 400 });
  });
  it("throws badRequest (400) on a non-JSON body", async () => {
    const r = req("http://localhost/api/x", jsonInit("not-json"));
    await expect(parseBody(r, schema)).rejects.toMatchObject({ status: 400 });
  });
});

describe("parseQuery", () => {
  const schema = z.object({ limit: z.string() });
  it("parses present query params", () => {
    expect(parseQuery(req("http://localhost/api/x?limit=10"), schema)).toEqual({ limit: "10" });
  });
  it("throws on missing required params", () => {
    expect(() => parseQuery(req("http://localhost/api/x"), schema)).toThrow();
  });
});

describe("route", () => {
  it("renders a thrown AppError as the error envelope with its status", async () => {
    const handler = route(async () => {
      throw notFound("nope");
    });
    const res = await handler(req("http://localhost/api/x"), { params: Promise.resolve({}) });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "NOT_FOUND", message: "nope" } });
  });
  it("renders a ZodError as a 400 BAD_REQUEST envelope", async () => {
    const handler = route(async (r) => {
      await parseBody(r, z.object({ a: z.number() }));
      return json({});
    });
    const res = await handler(req("http://localhost/api/x", jsonInit("{}")), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("BAD_REQUEST");
  });
  it("passes awaited route params to the handler context", async () => {
    const handler = route(async (_r, ctx) => json({ id: ctx.params.id }));
    const res = await handler(req("http://localhost/api/x"), {
      params: Promise.resolve({ id: "abc" }),
    });
    expect(await res.json()).toEqual({ id: "abc" });
  });
  it("masks unexpected errors as a 500 SERVER_ERROR envelope", async () => {
    const handler = route(async () => {
      throw new Error("boom internal");
    });
    const res = await handler(req("http://localhost/api/x"), { params: Promise.resolve({}) });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("SERVER_ERROR");
    expect(JSON.stringify(body)).not.toContain("boom internal");
  });
});
