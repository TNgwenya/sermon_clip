import { describe, expect, it } from "vitest";

import { buildSermonSourceRevision } from "./sermonOrchestrationService";

describe("sermon orchestration source revision", () => {
  const base = {
    youtubeUrl: "https://example.test/sermon",
    sourceAsset: null,
    sermonStartSeconds: 10,
    sermonEndSeconds: 1_810,
    analyzeFullRecording: false,
  };

  it("is stable for the same source and sermon range", () => {
    expect(buildSermonSourceRevision(base)).toBe(buildSermonSourceRevision({ ...base }));
  });

  it("changes when source version or sermon boundaries change", () => {
    const first = buildSermonSourceRevision({
      ...base,
      sourceAsset: {
        objectKey: "org/sermon/source.mp4",
        etag: "etag-1",
        versionId: "version-1",
        updatedAt: new Date("2026-08-21T10:00:00Z"),
      },
    });
    expect(buildSermonSourceRevision({ ...base, sermonEndSeconds: 1_900 })).not.toBe(first);
    expect(buildSermonSourceRevision({
      ...base,
      sourceAsset: {
        objectKey: "org/sermon/source.mp4",
        etag: "etag-2",
        versionId: "version-2",
        updatedAt: new Date("2026-08-21T10:01:00Z"),
      },
    })).not.toBe(first);
  });
});
