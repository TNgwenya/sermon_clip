import { describe, expect, it } from "vitest";

import {
  STALE_CLIP_OPERATION_MS,
  buildStaleClipOperationRecovery,
  isStaleClipOperation,
} from "@/lib/staleClipOperations";

const now = new Date("2026-07-22T08:00:00.000Z");

function clip(overrides: Partial<Parameters<typeof buildStaleClipOperationRecovery>[0]> = {}) {
  return {
    updatedAt: new Date(now.getTime() - STALE_CLIP_OPERATION_MS - 1),
    renderStatus: "NOT_RENDERED" as const,
    captionStatus: "NOT_GENERATED" as const,
    captionBurnStatus: "NOT_BURNED" as const,
    overlayStatus: "NOT_RENDERED" as const,
    exportStatus: "NOT_EXPORTED" as const,
    ...overrides,
  };
}

describe("stale clip operation recovery", () => {
  it("does not touch an operation that is still within the safe processing window", () => {
    const activeClip = clip({
      updatedAt: new Date(now.getTime() - STALE_CLIP_OPERATION_MS + 1),
      renderStatus: "RENDERING",
    });

    expect(isStaleClipOperation(activeClip, now)).toBe(false);
    expect(buildStaleClipOperationRecovery(activeClip, now)).toEqual({ operations: [], data: {} });
  });

  it("releases only stale active states and marks their assets for regeneration", () => {
    const result = buildStaleClipOperationRecovery(clip({
      renderStatus: "RENDERING",
      captionStatus: "GENERATING",
      exportStatus: "EXPORTING",
    }), now);

    expect(result.operations).toEqual(["render", "captions", "export"]);
    expect(result.data).toMatchObject({
      renderStatus: "FAILED",
      renderFreshness: "NEEDS_REGENERATION",
      captionStatus: "FAILED",
      captionFreshness: "NEEDS_REGENERATION",
      exportStatus: "FAILED",
      exportFreshness: "NEEDS_REGENERATION",
    });
  });

  it("leaves an old clip alone when no operation is active", () => {
    expect(buildStaleClipOperationRecovery(clip(), now)).toEqual({ operations: [], data: {} });
  });
});
