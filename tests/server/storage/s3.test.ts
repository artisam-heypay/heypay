import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aws-sdk/s3-presigned-post", async () => ({
  createPresignedPost: vi.fn(),
}));

import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import {
  __resetS3ForTests,
  ensureBucket,
  presignUpload,
  verifyUploadedObject,
} from "@/server/storage/s3";

const mockedPresign = createPresignedPost as unknown as ReturnType<typeof vi.fn>;
const s3Mock = mockClient(S3Client);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const NOT_IMAGE = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // "%PDF-"

beforeEach(() => {
  process.env.S3_BUCKET = "heypay-uploads";
  process.env.S3_REGION = "us-east-1";
  process.env.S3_ENDPOINT = "http://localhost:9000";
  process.env.S3_ACCESS_KEY = "heypay";
  process.env.S3_SECRET_KEY = "heypay-secret";
  process.env.S3_FORCE_PATH_STYLE = "true";
  s3Mock.reset();
  mockedPresign.mockReset();
  __resetS3ForTests();
});
afterEach(() => vi.clearAllMocks());

describe("presignUpload", () => {
  it("returns a random key under the prefix and a size-bounded policy", async () => {
    mockedPresign.mockResolvedValue({
      url: "http://localhost:9000/heypay-uploads",
      fields: { key: "x" },
    });
    const out = await presignUpload({
      prefix: "qrph",
      contentType: "image/png",
      maxBytes: 1_000_000,
    });
    expect(out.key).toMatch(/^qrph\/[0-9a-f-]+\.png$/);
    expect(out.url).toContain("heypay-uploads");
    const args = mockedPresign.mock.calls[0]![1];
    expect(args.Conditions).toEqual(
      expect.arrayContaining([["content-length-range", 1, 1_000_000]]),
    );
  });

  it("rejects an unsupported content type", async () => {
    await expect(
      presignUpload({ prefix: "logo", contentType: "image/gif", maxBytes: 1000 }),
    ).rejects.toThrow(/content type/i);
  });
});

describe("verifyUploadedObject", () => {
  it("accepts a valid PNG", async () => {
    s3Mock.on(HeadObjectCommand).resolves({ ContentLength: 1024 });
    s3Mock.on(GetObjectCommand).resolves({
      Body: { transformToByteArray: async () => PNG } as never,
    });
    await expect(verifyUploadedObject("qrph/abc.png")).resolves.toBeUndefined();
  });

  it("rejects non-image magic bytes", async () => {
    s3Mock.on(HeadObjectCommand).resolves({ ContentLength: 1024 });
    s3Mock.on(GetObjectCommand).resolves({
      Body: { transformToByteArray: async () => NOT_IMAGE } as never,
    });
    await expect(verifyUploadedObject("qrph/abc.png")).rejects.toThrow(/png or jpeg/i);
  });

  it("rejects an oversize object", async () => {
    s3Mock.on(HeadObjectCommand).resolves({ ContentLength: 99_000_000 });
    await expect(verifyUploadedObject("qrph/abc.png")).rejects.toThrow(/size/i);
  });
});

describe("ensureBucket", () => {
  it("creates the bucket when it does not exist", async () => {
    s3Mock.on(HeadBucketCommand).rejects({ $metadata: { httpStatusCode: 404 } });
    s3Mock.on(CreateBucketCommand).resolves({});
    await ensureBucket();
    expect(s3Mock.commandCalls(CreateBucketCommand)).toHaveLength(1);
  });

  it("is a no-op when the bucket already exists", async () => {
    s3Mock.on(HeadBucketCommand).resolves({});
    await ensureBucket();
    expect(s3Mock.commandCalls(CreateBucketCommand)).toHaveLength(0);
  });
});
