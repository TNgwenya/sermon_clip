import { mkdtemp, mkdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ARCHIVE_SCHEMA_VERSION,
  archiveBlobObjectKey,
  buildArchivePlan,
  ensureSafeArchiveDestinationParent,
  resolveArchiveDestination,
  shouldArchiveRelativePath,
  validateArchiveManifest,
  verifyArchiveSource,
} from "../media-archive-core";

const temporaryDirectories: string[] = [];

async function createTempStorage(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "sermon-archive-test-"));
  temporaryDirectories.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("media archive core", () => {
  it("selects durable sources and metadata while excluding regenerable media", () => {
    expect(shouldArchiveRelativePath("sermons/grace/source/source.mp4")).toBe(true);
    expect(shouldArchiveRelativePath("sermons/grace/transcript/transcript.json")).toBe(true);
    expect(shouldArchiveRelativePath("sermons/grace/clips/subtitles/clip.srt")).toBe(true);
    expect(shouldArchiveRelativePath("sermons/grace/clips/exports/clip.mp4")).toBe(true);
    expect(shouldArchiveRelativePath("sermons/grace/clips/thumbnails/clip.jpg")).toBe(true);
    expect(shouldArchiveRelativePath("sermons/grace/audio/audio.mp3")).toBe(true);
    expect(shouldArchiveRelativePath("sermons/.sermon-folders.json")).toBe(true);
    expect(shouldArchiveRelativePath("branding/logo.png")).toBe(true);
    expect(shouldArchiveRelativePath("cache/render.log")).toBe(false);
    expect(shouldArchiveRelativePath("secrets/worker-token.txt")).toBe(false);
    expect(shouldArchiveRelativePath("sermons/grace/transcript/sermon-window-audio.mp3")).toBe(false);
    expect(shouldArchiveRelativePath("sermons/grace/clips/rendered/clip.mp4")).toBe(false);
    expect(shouldArchiveRelativePath("sermons/grace/.DS_Store")).toBe(false);
  });

  it("builds a content-addressed plan and deduplicates identical files", async () => {
    const root = await createTempStorage();
    const sourceA = path.join(root, "sermons", "one", "source", "source.mp4");
    const sourceB = path.join(root, "sermons", "two", "source", "source.mp4");
    const transcript = path.join(root, "sermons", "one", "transcript", "transcript.json");
    const audio = path.join(root, "sermons", "one", "audio", "audio.mp3");
    await Promise.all([sourceA, sourceB, transcript, audio].map((file) => mkdir(path.dirname(file), { recursive: true })));
    await writeFile(sourceA, "same-source");
    await writeFile(sourceB, "same-source");
    await writeFile(transcript, "{\"text\":\"Grace\"}");
    await writeFile(audio, "regenerable-audio");

    const plan = await buildArchivePlan(root, new Date("2026-07-17T12:00:00.000Z"));

    expect(plan.manifest.files.map((file) => file.path)).toEqual([
      "sermons/one/audio/audio.mp3",
      "sermons/one/source/source.mp4",
      "sermons/one/transcript/transcript.json",
      "sermons/two/source/source.mp4",
    ]);
    expect(plan.uniqueBlobCount).toBe(3);
    expect(plan.deduplicatedBytes).toBe(Buffer.byteLength("same-source"));
    expect(plan.manifest.files[0]?.objectKey).toBe(archiveBlobObjectKey(plan.manifest.files[0]!.sha256));
  });

  it("rejects traversal and malformed manifest entries", () => {
    expect(() => resolveArchiveDestination("/srv/sermon-clip/storage", "../secret.mp4")).toThrow("Unsafe");
    expect(() => validateArchiveManifest({
      schemaVersion: ARCHIVE_SCHEMA_VERSION,
      generatedAt: "2026-07-17T12:00:00.000Z",
      files: [{
        path: "../secret.mp4",
        size: 12,
        sha256: "a".repeat(64),
        objectKey: archiveBlobObjectKey("a".repeat(64)),
      }],
    })).toThrow("invalid");
  });

  it("rejects non-canonical manifest paths that resolve to the same destination", () => {
    const manifestFile = {
      size: 12,
      sha256: "c".repeat(64),
      objectKey: archiveBlobObjectKey("c".repeat(64)),
    };

    for (const unsafePath of ["./branding/logo.png", "branding\\logo.png"]) {
      expect(() => validateArchiveManifest({
        schemaVersion: ARCHIVE_SCHEMA_VERSION,
        generatedAt: "2026-07-17T12:00:00.000Z",
        files: [{ ...manifestFile, path: unsafePath }],
      })).toThrow("invalid");
    }
  });

  it("revalidates a planned source immediately before upload", async () => {
    const root = await createTempStorage();
    const source = path.join(root, "sermons", "one", "source", "source.mp4");
    await mkdir(path.dirname(source), { recursive: true });
    await writeFile(source, "planned-source");
    const plan = await buildArchivePlan(root);
    const planned = plan.manifest.files[0]!;

    await expect(verifyArchiveSource(source, planned.size, planned.sha256)).resolves.toBeUndefined();
    await writeFile(source, "changed-source");
    await expect(verifyArchiveSource(source, planned.size, planned.sha256)).rejects.toThrow("no longer matches");
  });

  it("rejects a nested symlink before creating archive destination directories outside the root", async () => {
    const root = await createTempStorage();
    const outside = await createTempStorage();
    await symlink(outside, path.join(root, "branding"));
    const destination = path.join(root, "branding", "new", "church-logo.png");

    await expect(ensureSafeArchiveDestinationParent(root, destination)).rejects.toThrow("symbolic link");
    await expect(stat(path.join(outside, "new"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects duplicate restore destinations", () => {
    const file = {
      path: "sermons/grace/source/source.mp4",
      size: 12,
      sha256: "b".repeat(64),
      objectKey: archiveBlobObjectKey("b".repeat(64)),
    };
    expect(() => validateArchiveManifest({
      schemaVersion: ARCHIVE_SCHEMA_VERSION,
      generatedAt: "2026-07-17T12:00:00.000Z",
      files: [file, file],
    })).toThrow("duplicate");
  });
});
