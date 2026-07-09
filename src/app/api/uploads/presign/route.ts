import { z } from "zod";
import { route, json, parseBody } from "@/lib/http";
import { requireUser } from "@/server/auth/sessions";
import { presignUpload, verifyUploadedObject } from "@/server/storage/s3";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MiB
const CONTENT_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

const BodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("presign"),
    prefix: z.enum(["qrph", "logo"]),
    contentType: z.enum(CONTENT_TYPES),
    sizeBytes: z.number().int().positive().max(MAX_BYTES),
  }),
  z.object({
    action: z.literal("verify"),
    key: z.string().min(1).max(256),
  }),
]);

export const POST = route(async (req) => {
  await requireUser();
  const body = await parseBody(req, BodySchema);

  if (body.action === "presign") {
    const result = await presignUpload({
      prefix: body.prefix,
      contentType: body.contentType,
      maxBytes: MAX_BYTES,
    });
    return json(result);
  }

  await verifyUploadedObject(body.key);
  return json({ ok: true });
});
