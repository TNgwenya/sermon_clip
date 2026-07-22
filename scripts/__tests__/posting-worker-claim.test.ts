import { afterEach, describe, expect, it, vi } from "vitest";

import { __postingWorkerTestUtils } from "../posting-worker.ts";
import type { AutomationPost } from "../posting-platforms.ts";

function automationPost(overrides: Partial<AutomationPost> = {}): AutomationPost {
  return {
    id: "post-1",
    socialAccountId: null,
    platform: "Instagram",
    title: "Saved title",
    caption: "Saved caption",
    scheduledFor: "2099-07-23T08:00:00.000Z",
    idempotencyKey: "post-1-key",
    clips: [{
      id: "clip-1",
      title: "Clip",
      caption: "Clip caption",
      durationSeconds: 45,
      hashtags: ["#faith"],
      localFileCandidates: ["/exports/cached-old.mp4"],
      sermon: {
        title: "Faithfulness",
        churchName: "Grace Church",
      },
    }],
    ...overrides,
  };
}

describe("posting worker claim payload", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the fresh server payload instead of the cached queue payload", async () => {
    const cached = automationPost();
    const claimed = automationPost({
      caption: "Fresh caption from claim",
      clips: [{
        ...cached.clips[0],
        localFileCandidates: ["/exports/fresh-final.mp4"],
      }],
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      scheduledPost: claimed,
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })));

    await expect(__postingWorkerTestUtils.claimPost(cached)).resolves.toEqual(claimed);
  });

  it("rejects a claim payload that offers partial-media fallback paths", async () => {
    const cached = automationPost();
    const unsafeClaim = automationPost({
      clips: [{
        ...cached.clips[0],
        localFileCandidates: ["/exports/final.mp4", "/overlays/older.mp4"],
      }],
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      scheduledPost: unsafeClaim,
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })));

    await expect(__postingWorkerTestUtils.claimPost(cached)).resolves.toBeNull();
  });
});
