import { describe, expect, it } from "vitest";

import { serializeProcessingError } from "@/server/agents/processing";

describe("processing failure diagnostics", () => {
  it("preserves bounded error identity, code, stack, and cause", () => {
    const cause = Object.assign(new Error("database timed out"), { code: "P1002" });
    const error = Object.assign(new Error("clip generation failed", { cause }), {
      code: "CLIP_REVIEW_BOARD_BELOW_FLOOR",
    });
    error.stack = `Error: clip generation failed\n${"x".repeat(8_000)}`;

    const diagnostic = serializeProcessingError(error);

    expect(diagnostic).toMatchObject({
      name: "Error",
      message: "clip generation failed",
      code: "CLIP_REVIEW_BOARD_BELOW_FLOOR",
      cause: {
        name: "Error",
        message: "database timed out",
        code: "P1002",
      },
    });
    expect(diagnostic.stack?.length).toBeLessThanOrEqual(4_000);
  });

  it("normalizes non-Error failures", () => {
    expect(serializeProcessingError("worker stopped")).toMatchObject({
      name: "Error",
      message: "worker stopped",
    });
  });

  it("captures primitive correlation fields from typed errors", () => {
    const error = Object.assign(new Error("Invalid status transition"), {
      code: "INVALID_SERMON_STATUS_TRANSITION",
      sermonId: "sermon-1",
      currentStatus: "GENERATING_CLIPS",
      nextStatus: "TRANSCRIBING",
    });

    expect(serializeProcessingError(error).context).toEqual({
      sermonId: "sermon-1",
      currentStatus: "GENERATING_CLIPS",
      nextStatus: "TRANSCRIBING",
    });
  });
});
