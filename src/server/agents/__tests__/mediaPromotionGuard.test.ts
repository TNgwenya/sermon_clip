import { access, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  capturePromotedMediaIdentity,
  discardPromotedMediaIfUnchanged,
} from "../mediaPromotionGuard";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "media-promotion-guard-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("media promotion cleanup guard", () => {
  it("deletes the stale output when the canonical path still points to that job's promoted file", async () => {
    const directory = await createTemporaryDirectory();
    const canonicalPath = path.join(directory, "clip.mp4");
    await writeFile(canonicalPath, "old-plan-output");
    const identity = await capturePromotedMediaIdentity(canonicalPath);

    await expect(discardPromotedMediaIfUnchanged(canonicalPath, identity)).resolves.toBe(true);
    await expect(access(canonicalPath)).rejects.toThrow();
  });

  it("does not let an old completion delete a newer plan's promoted output", async () => {
    const directory = await createTemporaryDirectory();
    const canonicalPath = path.join(directory, "clip.mp4");
    const newerTempPath = path.join(directory, "clip.plan-new.partial.mp4");
    await writeFile(canonicalPath, "old-plan-output");
    const oldIdentity = await capturePromotedMediaIdentity(canonicalPath);

    await writeFile(newerTempPath, "new-plan-output");
    await rename(newerTempPath, canonicalPath);

    await expect(discardPromotedMediaIfUnchanged(canonicalPath, oldIdentity)).resolves.toBe(false);
    await expect(readFile(canonicalPath, "utf8")).resolves.toBe("new-plan-output");
  });
});
