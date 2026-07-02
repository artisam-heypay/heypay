import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { requireUser } from "@/server/auth/sessions";
import { presignUpload, verifyUploadedObject } from "@/server/storage/s3";
import { unauthorized } from "@/lib/errors";

vi.mock("@/server/auth/sessions", () => ({ requireUser: vi.fn() }));
vi.mock("@/server/storage/s3", () => ({
  presignUpload: vi.fn(async () => ({
    url: "http://localhost:9000/heypay-uploads",
    fields: { key: "qrph/abc.png", policy: "x" },
    key: "qrph/abc.png",
  })),
  verifyUploadedObject: vi.fn(async () => undefined),
}));

import { POST } from "@/app/api/uploads/presign/route";

function makeReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/uploads/presign", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      "sec-fetch-site": "same-origin",
    },
  });
}
const ctx = { params: Promise.resolve({}) };

describe("POST /api/uploads/presign", () => {
  beforeEach(() => {
    (requireUser as ReturnType<typeof vi.fn>)
      .mockReset()
      .mockResolvedValue({ id: "u1", username: "u", role: "MERCHANT", isActive: true });
    (presignUpload as ReturnType<typeof vi.fn>).mockClear();
    (verifyUploadedObject as ReturnType<typeof vi.fn>).mockClear();
  });

  it("returns a presigned POST for a valid image request", async () => {
    const res = await POST(
      makeReq({ action: "presign", prefix: "qrph", contentType: "image/png", sizeBytes: 1024 }),
      ctx,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ key: "qrph/abc.png", url: expect.any(String) });
    expect(presignUpload).toHaveBeenCalledWith({
      prefix: "qrph",
      contentType: "image/png",
      maxBytes: 5 * 1024 * 1024,
    });
  });

  it("rejects a disallowed content type with 400", async () => {
    const res = await POST(
      makeReq({
        action: "presign",
        prefix: "qrph",
        contentType: "application/pdf",
        sizeBytes: 1024,
      }),
      ctx,
    );
    expect(res.status).toBe(400);
    expect(presignUpload).not.toHaveBeenCalled();
  });

  it("rejects an oversize request with 400", async () => {
    const res = await POST(
      makeReq({
        action: "presign",
        prefix: "logo",
        contentType: "image/jpeg",
        sizeBytes: 6 * 1024 * 1024,
      }),
      ctx,
    );
    expect(res.status).toBe(400);
  });

  it("verifies an uploaded object", async () => {
    const res = await POST(makeReq({ action: "verify", key: "qrph/abc.png" }), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
    expect(verifyUploadedObject).toHaveBeenCalledWith("qrph/abc.png");
  });

  it("401s when unauthenticated", async () => {
    (requireUser as ReturnType<typeof vi.fn>).mockRejectedValueOnce(unauthorized());
    const res = await POST(makeReq({ action: "verify", key: "qrph/abc.png" }), ctx);
    expect(res.status).toBe(401);
  });
});
