import { describe, expect, it } from "vitest";

import { isEditoriallyPostReady } from "@/app/ready-to-post/readiness-display";

describe("publishing readiness display", () => {
  it("does not confuse prepared media with editorial post readiness", () => {
    expect(isEditoriallyPostReady({
      mediaReady: true,
      qualityLabel: "GOOD_NEEDS_REVIEW",
      postReadyStatus: "NEEDS_EDITING",
      postReadyBlockers: [],
    })).toBe(false);
  });

  it("lets the current post-readiness status override a stale quality label", () => {
    expect(isEditoriallyPostReady({
      mediaReady: true,
      qualityLabel: "POST_READY",
      postReadyStatus: "NEEDS_EDITING",
      postReadyBlockers: [],
    })).toBe(false);
  });

  it("requires prepared media and no blockers", () => {
    expect(isEditoriallyPostReady({
      mediaReady: true,
      qualityLabel: "POST_READY",
      postReadyStatus: "POST_READY",
      postReadyBlockers: [],
    })).toBe(true);
    expect(isEditoriallyPostReady({
      mediaReady: true,
      qualityLabel: "POST_READY",
      postReadyStatus: "POST_READY",
      postReadyBlockers: ["Review the crop."],
    })).toBe(false);
  });
});
