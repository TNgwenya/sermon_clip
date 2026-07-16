import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const s3Mock = vi.hoisted(() => ({
  send: vi.fn(async (command: unknown) => {
    void command;
    return {};
  }),
  configs: [] as Array<Record<string, unknown>>,
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
  buildContentAssetObjectKey,
  buildContentAssetPublicUrl,
  isContentAssetPublicStorageConfigured,
  uploadContentAssetFileToR2,
} from "@/server/contentAssets/contentAssetPublicStorage";

afterEach(() => {
  vi.unstubAllEnvs();
  s3Mock.send.mockClear();
});

function configureR2(): void {
  vi.stubEnv("R2_ACCOUNT_ID", "ccec8a45b35c669f20ae3380a0f5859d");
  vi.stubEnv("R2_ACCESS_KEY_ID", "12345678901234567890123456789012");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "secret-key");
  vi.stubEnv("R2_BUCKET", "sermon-clip-exports");
  vi.stubEnv("R2_PUBLIC_BASE_URL", "https://media.example.com/");
}

describe("content asset public storage", () => {
  it("builds deterministic publishing keys and HTTPS public URLs", () => {
    configureR2();

    const key = buildContentAssetObjectKey({
      contentAssetId: "asset 1",
      fileId: "file/1",
      fileName: "portrait.jpg",
    });

    expect(key).toBe("content-assets/asset-1/publishing/file-1.jpg");
    expect(buildContentAssetPublicUrl(key)).toBe("https://media.example.com/content-assets/asset-1/publishing/file-1.jpg");
    expect(isContentAssetPublicStorageConfigured()).toBe(true);
  });

  it("uploads the exact JPEG publishing file with a stable object key", async () => {
    configureR2();
    const directory = await mkdtemp(path.join(tmpdir(), "content-asset-r2-"));
    const filePath = path.join(directory, "portrait.jpg");
    await writeFile(filePath, Buffer.from("jpeg-data"));

    try {
      const result = await uploadContentAssetFileToR2({
        contentAssetId: "asset-1",
        fileId: "jpeg-1",
        fileName: "portrait.jpg",
        filePath,
        mimeType: "image/jpeg",
      });

      expect(result.objectKey).toBe("content-assets/asset-1/publishing/jpeg-1.jpg");
      expect(result.publicUrl).toBe("https://media.example.com/content-assets/asset-1/publishing/jpeg-1.jpg");
      const command = s3Mock.send.mock.calls[0]?.[0] as { input?: Record<string, unknown> };
      expect(command.input).toMatchObject({
        Bucket: "sermon-clip-exports",
        Key: "content-assets/asset-1/publishing/jpeg-1.jpg",
        ContentType: "image/jpeg",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("refuses automatic preparation when public storage is incomplete", async () => {
    vi.stubEnv("R2_CONTENT_ASSET_UPLOAD_DISABLED", "true");

    expect(isContentAssetPublicStorageConfigured()).toBe(false);
    await expect(uploadContentAssetFileToR2({
      contentAssetId: "asset-1",
      fileId: "jpeg-1",
      fileName: "portrait.jpg",
      filePath: "/tmp/missing.jpg",
      mimeType: "image/jpeg",
    })).rejects.toThrow("Public R2 media storage is not configured");
  });
});
