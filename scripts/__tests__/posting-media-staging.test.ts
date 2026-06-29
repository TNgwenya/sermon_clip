import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const s3Mock = vi.hoisted(() => ({
  configs: [] as Array<Record<string, unknown>>,
  send: vi.fn(async () => ({})),
}));

vi.mock("@aws-sdk/client-s3", () => ({
  PutObjectCommand: class {
    input: unknown;

    constructor(input: unknown) {
      this.input = input;
    }
  },
  S3Client: class {
    constructor(config: Record<string, unknown>) {
      s3Mock.configs.push(config);
    }

    send = s3Mock.send;
  },
}));

import {
  buildPostingMediaObjectKey,
  buildR2PublicUrl,
  uploadPostingMediaToR2,
} from "../posting-media-staging";

afterEach(() => {
  vi.unstubAllEnvs();
  s3Mock.configs.length = 0;
  s3Mock.send.mockClear();
});

describe("posting media staging", () => {
  it("builds stable R2 object keys for temporary posting media", () => {
    expect(buildPostingMediaObjectKey({
      scheduledPostId: "post 1",
      clipId: "clip/1",
      filename: "/tmp/export.mp4",
    })).toBe("posting-temp/post-1/clip-1.mp4");
  });

  it("builds public HTTPS URLs for R2 objects", () => {
    vi.stubEnv("R2_PUBLIC_BASE_URL", "https://media.example.com/");

    expect(buildR2PublicUrl("posting-temp/post-1/clip-1.mp4"))
      .toBe("https://media.example.com/posting-temp/post-1/clip-1.mp4");
  });

  it("rejects non-HTTPS public media bases", () => {
    vi.stubEnv("R2_PUBLIC_BASE_URL", "http://media.example.com");

    expect(() => buildR2PublicUrl("posting-temp/post-1/clip-1.mp4")).toThrow("HTTPS");
  });

  it("uses path-style addressing for Cloudflare R2 uploads", async () => {
    vi.stubEnv("R2_ACCOUNT_ID", "ccec8a45b35c669f20ae3380a0f5859d");
    vi.stubEnv("R2_ACCESS_KEY_ID", "12345678901234567890123456789012");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "secret-key");
    vi.stubEnv("R2_BUCKET", "sermon-clip-exports");
    vi.stubEnv("R2_PUBLIC_BASE_URL", "https://pub-example.r2.dev");

    const tempDir = await mkdtemp(path.join(tmpdir(), "sermon-clip-r2-test-"));
    const videoPath = path.join(tempDir, "export.mp4");
    await writeFile(videoPath, "test-video");

    try {
      await uploadPostingMediaToR2({
        scheduledPostId: "post-1",
        clipId: "clip-1",
        videoPath,
        videoSize: 10,
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }

    expect(s3Mock.configs[0]).toMatchObject({
      endpoint: "https://ccec8a45b35c669f20ae3380a0f5859d.r2.cloudflarestorage.com",
      forcePathStyle: true,
    });
  });

  it("rejects invalid Cloudflare account ids before uploading", async () => {
    vi.stubEnv("R2_ACCOUNT_ID", "not-the-account-id");
    vi.stubEnv("R2_ACCESS_KEY_ID", "12345678901234567890123456789012");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "secret-key");
    vi.stubEnv("R2_BUCKET", "sermon-clip-exports");
    vi.stubEnv("R2_PUBLIC_BASE_URL", "https://pub-example.r2.dev");

    await expect(uploadPostingMediaToR2({
      scheduledPostId: "post-1",
      clipId: "clip-1",
      videoPath: "/tmp/export.mp4",
      videoSize: 10,
    })).rejects.toThrow("32-character Cloudflare Account ID");
  });

  it("rejects invalid R2 access key ids before uploading", async () => {
    vi.stubEnv("R2_ACCOUNT_ID", "ccec8a45b35c669f20ae3380a0f5859d");
    vi.stubEnv("R2_ACCESS_KEY_ID", "not-the-r2-access-key-id");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "secret-key");
    vi.stubEnv("R2_BUCKET", "sermon-clip-exports");
    vi.stubEnv("R2_PUBLIC_BASE_URL", "https://pub-example.r2.dev");

    await expect(uploadPostingMediaToR2({
      scheduledPostId: "post-1",
      clipId: "clip-1",
      videoPath: "/tmp/export.mp4",
      videoSize: 10,
    })).rejects.toThrow("32-character R2 S3 access key ID");
  });
});
