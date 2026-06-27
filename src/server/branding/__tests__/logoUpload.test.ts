import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { getLogoUpload, maxLogoUploadBytes, saveLogoUpload } from "@/server/branding/logoUpload";

const tempDirectories: string[] = [];

async function createTempDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "branding-logo-upload-"));
  tempDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("branding logo uploads", () => {
  it("finds a selected logo file in form data", () => {
    const formData = new FormData();
    const file = new File(["logo"], "logo.svg", { type: "image/svg+xml" });

    formData.set("churchLogoFile", file);

    expect(getLogoUpload(formData)).toBe(file);
  });

  it("ignores an empty logo file", () => {
    const formData = new FormData();

    formData.set("churchLogoFile", new File([], "empty.svg", { type: "image/svg+xml" }));

    expect(getLogoUpload(formData)).toBeNull();
  });

  it("stores an accepted logo upload", async () => {
    const uploadDirectory = await createTempDirectory();
    const file = new File(["<svg />"], "logo.svg", { type: "image/svg+xml" });

    const result = await saveLogoUpload(file, {
      now: () => 1234,
      uploadDirectory,
    });

    expect(result.error).toBeUndefined();
    expect(result.path).toBe(join(uploadDirectory, "church-logo-1234.svg"));
    await expect(readFile(result.path ?? "", "utf8")).resolves.toBe("<svg />");
  });

  it("rejects unsupported logo formats", async () => {
    const result = await saveLogoUpload(new File(["not an image"], "logo.txt", { type: "text/plain" }), {
      uploadDirectory: await createTempDirectory(),
    });

    expect(result).toEqual({ error: "Upload a PNG, JPG, WebP, or SVG logo." });
  });

  it("rejects logos over the size limit without writing a file", async () => {
    const uploadDirectory = await createTempDirectory();
    const file = new File([new Uint8Array(maxLogoUploadBytes + 1)], "huge.png", { type: "image/png" });

    const result = await saveLogoUpload(file, { uploadDirectory });

    expect(result).toEqual({ error: "Logo must be 5MB or smaller." });
    await expect(readdir(uploadDirectory)).resolves.toEqual([]);
  });
});
