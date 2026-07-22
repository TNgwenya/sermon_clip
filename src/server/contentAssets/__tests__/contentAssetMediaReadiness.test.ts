import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  checkContentAssetMediaReadiness,
  isContentAssetPublishingObjectKey,
  probeReadableLocalContentAssetFile,
  type ContentAssetMediaReadinessDependencies,
  type ContentAssetMediaReadinessFile,
} from "@/server/contentAssets/contentAssetMediaReadiness";

const createdDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(createdDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function file(overrides: Partial<ContentAssetMediaReadinessFile> = {}): ContentAssetMediaReadinessFile {
  return {
    id: "file-1",
    fileName: "portrait.jpg",
    mimeType: "image/jpeg",
    filePath: null,
    objectKey: null,
    publicUrl: null,
    sizeBytes: 9_999,
    sortOrder: 0,
    ...overrides,
  };
}

function dependencies(overrides: Partial<ContentAssetMediaReadinessDependencies> = {}): ContentAssetMediaReadinessDependencies {
  return {
    probeLocalFile: vi.fn(async () => ({ byteLength: 128 })),
    probePublicUrl: vi.fn(async () => ({ byteLength: 256 })),
    publicUrlFromObjectKey: vi.fn((objectKey) => `https://media.example.com/${objectKey}`),
    isTrustedPublicUrl: vi.fn((publicUrl) => publicUrl.startsWith("https://media.example.com/content-assets/")),
    ...overrides,
  };
}

describe("content asset media readiness", () => {
  it("blocks when selection finds no publishing image even if a database size exists", async () => {
    const result = await checkContentAssetMediaReadiness({
      assetType: "QUOTE_GRAPHIC",
      platform: "Instagram",
      files: [file({ mimeType: "application/pdf", sizeBytes: 40_000 })],
      dependencies: dependencies(),
    });

    expect(result).toMatchObject({
      status: "BLOCKED",
      reason: "NO_PUBLISHING_FILES",
      selectedFileIds: [],
    });
  });

  it("establishes readable local bytes instead of trusting the stored size", async () => {
    const probeLocalFile = vi.fn(async () => ({ byteLength: 81 }));
    const result = await checkContentAssetMediaReadiness({
      assetType: "QUOTE_GRAPHIC",
      platform: "Facebook",
      files: [file({ filePath: "/srv/media/portrait.jpg", sizeBytes: 999_999 })],
      dependencies: dependencies({ probeLocalFile }),
    });

    expect(probeLocalFile).toHaveBeenCalledWith("/srv/media/portrait.jpg");
    expect(result).toMatchObject({
      status: "READY",
      reason: "SELECTED_FILES_READY",
      files: [{
        status: "READY",
        reason: "LOCAL_FILE_READABLE",
        source: "LOCAL_FILE",
        byteLength: 81,
      }],
    });
  });

  it("blocks an image row whose declared size has no readable location behind it", async () => {
    const result = await checkContentAssetMediaReadiness({
      assetType: "QUOTE_GRAPHIC",
      platform: "Facebook",
      files: [file({ sizeBytes: 400_000 })],
      dependencies: dependencies(),
    });

    expect(result).toMatchObject({
      status: "BLOCKED",
      reason: "PUBLISHING_FILE_UNAVAILABLE",
      files: [{
        status: "BLOCKED",
        reason: "NO_MEDIA_LOCATION",
        attempts: [],
      }],
    });
  });

  it("probes the authoritative trusted HTTPS URL and does not hide a stale URL with local bytes", async () => {
    const probeLocalFile = vi.fn(async () => ({ byteLength: 81 }));
    const probePublicUrl = vi.fn(async () => {
      throw new Error("404");
    });
    const result = await checkContentAssetMediaReadiness({
      assetType: "QUOTE_GRAPHIC",
      platform: "Instagram",
      files: [file({
        filePath: "/srv/media/portrait.jpg",
        publicUrl: "https://media.example.com/content-assets/asset-1/publishing/file-1.jpg",
      })],
      dependencies: dependencies({ probeLocalFile, probePublicUrl }),
    });

    expect(probePublicUrl).toHaveBeenCalledOnce();
    expect(probeLocalFile).not.toHaveBeenCalled();
    expect(result.files[0]).toMatchObject({
      status: "BLOCKED",
      reason: "PUBLIC_URL_UNREADABLE",
      attempts: [{ location: "PUBLIC_URL", reason: "UNREADABLE_LOCATION" }],
    });
  });

  it("blocks non-HTTPS and untrusted public locations without making an outbound probe", async () => {
    const probePublicUrl = vi.fn(async () => ({ byteLength: 256 }));
    const deps = dependencies({ probePublicUrl });
    const [httpResult, untrustedResult] = await Promise.all([
      checkContentAssetMediaReadiness({
        assetType: "QUOTE_GRAPHIC",
        platform: "Facebook",
        files: [file({ publicUrl: "http://media.example.com/content-assets/file.jpg" })],
        dependencies: deps,
      }),
      checkContentAssetMediaReadiness({
        assetType: "QUOTE_GRAPHIC",
        platform: "Facebook",
        files: [file({ publicUrl: "https://untrusted.example/file.jpg" })],
        dependencies: deps,
      }),
    ]);

    expect(httpResult.files[0]?.reason).toBe("PUBLIC_URL_NOT_HTTPS");
    expect(untrustedResult.files[0]?.reason).toBe("PUBLIC_URL_UNTRUSTED");
    expect(probePublicUrl).not.toHaveBeenCalled();
  });

  it("recovers missing local bytes from a valid object key and returns the public URL the caller must use", async () => {
    const probeLocalFile = vi.fn(async () => ({ byteLength: 0 }));
    const result = await checkContentAssetMediaReadiness({
      assetType: "QUOTE_GRAPHIC",
      platform: "Instagram",
      files: [file({
        filePath: "/srv/media/missing.jpg",
        objectKey: "content-assets/asset-1/publishing/file-1.jpg",
      })],
      dependencies: dependencies({ probeLocalFile }),
    });

    expect(result.files[0]).toMatchObject({
      status: "READY",
      reason: "OBJECT_KEY_READABLE",
      source: "OBJECT_KEY",
      byteLength: 256,
      effectivePublicUrl: "https://media.example.com/content-assets/asset-1/publishing/file-1.jpg",
      attempts: [
        { location: "LOCAL_FILE", status: "BLOCKED", reason: "EMPTY_LOCATION" },
        { location: "OBJECT_KEY", status: "READY", reason: "READABLE_BYTES" },
      ],
    });
  });

  it("checks every selected carousel slide in stable publishing order and blocks on the first unavailable slide", async () => {
    const probePublicUrl = vi.fn(async (publicUrl: string) => (
      publicUrl.includes("slide-2") ? { byteLength: 0 } : { byteLength: 512 }
    ));
    const result = await checkContentAssetMediaReadiness({
      assetType: "CAROUSEL",
      platform: "Instagram",
      files: [
        file({ id: "slide-2", fileName: "slide-2.jpg", sortOrder: 2, publicUrl: "https://media.example.com/content-assets/asset-1/publishing/slide-2.jpg" }),
        file({ id: "slide-1", fileName: "slide-1.jpg", sortOrder: 1, publicUrl: "https://media.example.com/content-assets/asset-1/publishing/slide-1.jpg" }),
      ],
      dependencies: dependencies({ probePublicUrl }),
    });

    expect(result).toMatchObject({
      status: "BLOCKED",
      reason: "PUBLISHING_FILE_UNAVAILABLE",
      selectedFileIds: ["slide-1", "slide-2"],
    });
    expect(result.files.map((item) => [item.id, item.reason])).toEqual([
      ["slide-1", "PUBLIC_URL_READABLE"],
      ["slide-2", "PUBLIC_URL_EMPTY"],
    ]);
  });

  it("uses the default local probe to reject zero-byte files and accept readable bytes", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "content-asset-readiness-"));
    createdDirectories.push(directory);
    const emptyPath = path.join(directory, "empty.jpg");
    const readyPath = path.join(directory, "ready.jpg");
    await Promise.all([
      writeFile(emptyPath, Buffer.alloc(0)),
      writeFile(readyPath, Buffer.from("jpeg-bytes")),
    ]);

    await expect(probeReadableLocalContentAssetFile(emptyPath)).resolves.toEqual({ byteLength: 0 });
    await expect(probeReadableLocalContentAssetFile(readyPath)).resolves.toEqual({ byteLength: 10 });
  });

  it("rejects object keys that could escape the content-assets publishing namespace", () => {
    expect(isContentAssetPublishingObjectKey("content-assets/asset-1/publishing/file-1.jpg")).toBe(true);
    expect(isContentAssetPublishingObjectKey("content-assets/../private/file.jpg")).toBe(false);
    expect(isContentAssetPublishingObjectKey("content-assets/asset-1/private/file.jpg")).toBe(false);
    expect(isContentAssetPublishingObjectKey("clip-previews/asset-1/file.jpg")).toBe(false);
  });
});
