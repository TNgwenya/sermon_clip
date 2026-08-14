import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const sourceState = vi.hoisted(() => ({ canonicalPath: "", restoredPath: "" }));
const materializeMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/agents/sourceMaterializationAgent", () => ({
  materializeS3SermonSource: materializeMock,
}));
vi.mock("@/server/agents/storage", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/server/agents/storage")>(),
  getSourceVideoPath: vi.fn(() => sourceState.canonicalPath),
}));

import { __clipRenderTestUtils } from "@/server/agents/clipRenderService";

let temporaryRoot = "";

describe("clip render durable source resolution", () => {
  beforeAll(async () => {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "clip-render-source-"));
    sourceState.canonicalPath = path.join(temporaryRoot, "canonical", "source.mp4");
    sourceState.restoredPath = path.join(temporaryRoot, "restored", "source.mp4");
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await rm(path.dirname(sourceState.canonicalPath), { recursive: true, force: true });
    await rm(path.dirname(sourceState.restoredPath), { recursive: true, force: true });
  });

  afterAll(async () => {
    await rm(temporaryRoot, { recursive: true, force: true });
  });

  it("materializes a READY private source when local media was retained out", async () => {
    await mkdir(path.dirname(sourceState.restoredPath), { recursive: true });
    await writeFile(sourceState.restoredPath, "video");
    materializeMock.mockResolvedValue({
      sourceVideoPath: sourceState.restoredPath,
      reusedExistingFile: false,
    });

    const result = await __clipRenderTestUtils.resolveSourceVideoForRender({
      sermonId: "sermon-1",
      sermon: {
        id: "sermon-1",
        sourceVideoPath: "sermon-storage://sermons/sermon-1/source/source.mp4",
        sourceDurationSeconds: 600,
        sourceAsset: { status: "READY" },
      },
    });

    expect(materializeMock).toHaveBeenCalledWith("sermon-1");
    expect(result).toEqual({
      sourceVideoPath: sourceState.restoredPath,
      sourceVideoExists: true,
    });
  });
});
