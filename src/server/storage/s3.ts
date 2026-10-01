import "server-only";
import { randomUUID } from "node:crypto";
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { badRequest } from "@/lib/errors";

export type PresignResult = { url: string; fields: Record<string, string>; key: string };

const ALLOWED_CONTENT_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
};
const MAX_OBJECT_BYTES = 5 * 1024 * 1024; // 5 MiB hard cap on verify
const PRESIGN_EXPIRES_SEC = 300;
const GET_URL_EXPIRES_SEC = 300;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

let client: S3Client | null = null;

function getS3(): S3Client {
  if (!client) {
    client = new S3Client({
      region: process.env.S3_REGION ?? "us-east-1",
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY ?? "",
        secretAccessKey: process.env.S3_SECRET_KEY ?? "",
      },
    });
  }
  return client;
}

function bucket(): string {
  const b = process.env.S3_BUCKET;
  if (!b) throw new Error("S3_BUCKET is not set");
  return b;
}

export function __resetS3ForTests(): void {
  client = null;
}

export async function presignUpload(input: {
  prefix: "qrph" | "logo";
  contentType: string;
  maxBytes: number;
}): Promise<PresignResult> {
  const ext = ALLOWED_CONTENT_TYPES[input.contentType];
  if (!ext) throw badRequest("Unsupported upload content type", { contentType: input.contentType });
  const key = `${input.prefix}/${randomUUID()}.${ext}`;
  const { url, fields } = await createPresignedPost(getS3(), {
    Bucket: bucket(),
    Key: key,
    Conditions: [
      ["content-length-range", 1, input.maxBytes],
      ["eq", "$Content-Type", input.contentType],
    ],
    Fields: { "Content-Type": input.contentType },
    Expires: PRESIGN_EXPIRES_SEC,
  });
  return { url, fields, key };
}

export async function verifyUploadedObject(key: string): Promise<void> {
  const head = await getS3().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
  const size = head.ContentLength ?? 0;
  if (size <= 0 || size > MAX_OBJECT_BYTES) {
    throw badRequest("Uploaded object size is out of bounds");
  }
  const obj = await getS3().send(
    new GetObjectCommand({ Bucket: bucket(), Key: key, Range: "bytes=0-7" }),
  );
  if (!obj.Body) throw badRequest("Uploaded object has no body");
  const bytes = Buffer.from(await obj.Body.transformToByteArray());
  const isPng = bytes.subarray(0, 8).equals(PNG_MAGIC);
  const isJpeg = bytes.subarray(0, 3).equals(JPEG_MAGIC);
  if (!isPng && !isJpeg) throw badRequest("Uploaded file is not a valid PNG or JPEG");
}

export function signedGetUrl(key: string): Promise<string> {
  return getSignedUrl(getS3(), new GetObjectCommand({ Bucket: bucket(), Key: key }), {
    expiresIn: GET_URL_EXPIRES_SEC,
  });
}

export async function ensureBucket(): Promise<void> {
  const name = bucket();
  try {
    await getS3().send(new HeadBucketCommand({ Bucket: name }));
  } catch (e) {
    const status = (e as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    const notFound =
      status === 404 || status === 301 || (e as { name?: string })?.name === "NotFound";
    if (!notFound) throw e;
    await getS3().send(new CreateBucketCommand({ Bucket: name }));
  }
}
