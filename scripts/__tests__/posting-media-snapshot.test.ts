import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createPostingMediaSnapshot } from "../posting-media-snapshot";

const snapshots: Array<{ remove(): Promise<void> }> = [];
const sourceDirs: string[] = [];

afterEach(async () => {
  await Promise.all(snapshots.splice(0).map((snapshot) => snapshot.remove()));
  await Promise.all(sourceDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("posting media snapshot", () => {
  it("copies and hashes a composition-specific immutable publishing input", async () => {
    const sourceDir = await mkdtemp(path.join(tmpdir(), "sermon-clip-source-"));
    sourceDirs.push(sourceDir);
    const sourcePath = path.join(sourceDir, "final.mp4");
    await writeFile(sourcePath, "canonical-final-video");

    const snapshot = await createPostingMediaSnapshot({
      sourcePath,
      clipId: "clip/1",
      editPlanId: "plan 7",
      artifactId: "artifact:9",
      planHash: "abc123",
      expectedSizeBytes: 21,
    });
    snapshots.push(snapshot);

    expect(snapshot.filePath).toContain("clip-1.plan-7.artifact-9.abc123.mp4");
    expect(snapshot.sizeBytes).toBe(21);
    expect(snapshot.sha256).toBe("004d9ee541e3d5adb7f36e513881f55041078f48164a57deda6c2ac01d8b664c");
    await expect(stat(snapshot.filePath)).resolves.toMatchObject({ size: 21 });
  });

  it("rejects a source whose bytes no longer match the artifact size", async () => {
    const sourceDir = await mkdtemp(path.join(tmpdir(), "sermon-clip-source-"));
    sourceDirs.push(sourceDir);
    const sourcePath = path.join(sourceDir, "final.mp4");
    await writeFile(sourcePath, "changed");

    await expect(createPostingMediaSnapshot({
      sourcePath,
      clipId: "clip-1",
      editPlanId: "plan-1",
      artifactId: "artifact-1",
      planHash: "abc123",
      expectedSizeBytes: 99,
    })).rejects.toThrow("size no longer matches");
  });
});
