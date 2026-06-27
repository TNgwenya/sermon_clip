import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildPostingPackageDownloadHref,
  listPostingPackageHistory,
  prunePostingPackageHistoryByClipIds,
  recordPostingPackage,
} from "@/lib/postingPackages";

const originalCwd = process.cwd();
const originalStorePath = process.env.POSTING_PACKAGE_HISTORY_PATH;
let tempDir = "";

describe("posting package history", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "posting-packages-"));
    process.env.POSTING_PACKAGE_HISTORY_PATH = path.join(tempDir, "posting-packages.json");
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    if (originalStorePath) {
      process.env.POSTING_PACKAGE_HISTORY_PATH = originalStorePath;
    } else {
      delete process.env.POSTING_PACKAGE_HISTORY_PATH;
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  it("records and lists recent posting package handoffs", async () => {
    const item = await recordPostingPackage({
      clipIds: ["clip-1", "clip-2"],
      clipTitles: ["First clip", "Second clip"],
      sermonTitle: "Sunday sermon",
      churchName: "Local Church",
      fileName: "sunday-sermon-posting-package.zip",
      totalVideoBytes: 2048,
    });

    const history = await listPostingPackageHistory();

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      id: item.id,
      clipCount: 2,
      fileName: "sunday-sermon-posting-package.zip",
      totalVideoBytes: 2048,
    });
  });

  it("builds re-download links from stored package clip ids", () => {
    expect(buildPostingPackageDownloadHref(["clip-1", "clip-2", "clip-1", " "])).toBe(
      "/api/ready-to-post/download?clipIds=clip-1%2Cclip-2",
    );
    expect(buildPostingPackageDownloadHref([])).toBe("/api/ready-to-post/download?clipIds=all");
  });

  it("prunes package history that references deleted clip ids", async () => {
    await recordPostingPackage({
      clipIds: ["clip-old", "clip-keep"],
      clipTitles: ["Old clip", "Keep clip"],
      sermonTitle: "Sunday sermon",
      churchName: "Local Church",
      fileName: "old-package.zip",
      totalVideoBytes: 2048,
    });
    await recordPostingPackage({
      clipIds: ["clip-other"],
      clipTitles: ["Other clip"],
      sermonTitle: "Another sermon",
      churchName: "Local Church",
      fileName: "other-package.zip",
      totalVideoBytes: 1024,
    });

    const pruned = await prunePostingPackageHistoryByClipIds(["clip-old"]);
    const history = await listPostingPackageHistory();

    expect(pruned).toBe(1);
    expect(history).toHaveLength(1);
    expect(history[0]?.fileName).toBe("other-package.zip");
  });
});
