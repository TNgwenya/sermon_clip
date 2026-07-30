import { describe, expect, it } from "vitest";

import { buildCompetitiveQualityReport } from "@/server/quality/competitiveQualityReport";

function clip(overrides: Record<string, unknown> = {}) {
  return {
    status: "APPROVED",
    transcriptSafetyStatus: "TRUSTED",
    riskLevel: "LOW",
    contextWarning: false,
    finalQualityScore: 88,
    postReadyStatus: "POST_READY",
    visualReadinessScore: 90,
    renderStatus: "COMPLETED",
    remotePreviewUrl: "https://media.example/clip.mp4",
    exportedFilePath: null,
    overlayVideoPath: null,
    captionedVideoPath: null,
    renderedFilePath: null,
    ...overrides,
  };
}

describe("competitive quality report", () => {
  it("passes evidence-backed gates when a mature sample clears each target", () => {
    const report = buildCompetitiveQualityReport(
      Array.from({ length: 20 }, () => clip()),
    );

    expect(report.reviewedClipCount).toBe(20);
    expect(report.gates.every((item) => item.status === "PASS")).toBe(true);
    expect(report.gates.find((item) => item.id === "keeper")?.value).toBe(100);
  });

  it("withholds conclusions when the real sample is too small", () => {
    const report = buildCompetitiveQualityReport([clip()]);

    expect(report.gates.every((item) => item.status === "NEEDS_SAMPLE")).toBe(true);
  });

  it("surfaces preview, context, visual, and render failures without hiding them", () => {
    const clips = Array.from({ length: 20 }, (_, index) => clip(
      index < 3
        ? {
          remotePreviewUrl: null,
          renderStatus: "FAILED",
          transcriptSafetyStatus: "REVIEW_REQUIRED",
          riskLevel: "HIGH",
          contextWarning: true,
          visualReadinessScore: 35,
        }
        : {},
    ));
    const report = buildCompetitiveQualityReport(clips);

    expect(report.gates.find((item) => item.id === "preview")?.status).toBe("NEEDS_WORK");
    expect(report.gates.find((item) => item.id === "render")?.status).toBe("NEEDS_WORK");
    expect(report.gates.find((item) => item.id === "context")?.status).toBe("NEEDS_WORK");
    expect(report.gates.find((item) => item.id === "visual")?.status).toBe("NEEDS_WORK");
  });
});
