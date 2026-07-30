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
      compositionIdentity: {
        schemaVersion: 1,
        clipId: "clip-1",
        editPlanId: "plan-1",
        artifactId: "artifact-1",
        planHash: "plan-hash-1",
        filePath: "/exports/cached-old.mp4",
        sizeBytes: 1_024,
        snapshotSha256: null,
        snapshotSizeBytes: null,
      },
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
        compositionIdentity: {
          ...cached.clips[0].compositionIdentity!,
          artifactId: "artifact-2",
          filePath: "/exports/fresh-final.mp4",
        },
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

  it("rejects a clip claim payload without an immutable composition identity", async () => {
    const cached = automationPost();
    const unsafeClaim = automationPost({
      clips: [{
        ...cached.clips[0],
        compositionIdentity: undefined,
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

  it("keeps approved content-asset posts compatible without a clip composition", async () => {
    const contentPost = automationPost({
      clips: [],
      contentAssets: [{
        id: "asset-1",
        title: "Sunday quote",
        assetType: "QUOTE_GRAPHIC",
        status: "SCHEDULED",
        caption: "A faithful word",
        bodyContent: null,
        callToAction: null,
        hashtags: ["#faith"],
        files: [],
      }],
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      scheduledPost: contentPost,
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })));

    await expect(__postingWorkerTestUtils.claimPost(contentPost)).resolves.toEqual(contentPost);
  });

  it("revalidates the observed local path and size before external publishing", async () => {
    const post = automationPost();
    const publicationGuard = {
      approvedPreviewIdentity: "a".repeat(64),
      retryIdempotencyKey: "b".repeat(64),
      semanticDuplicateKey: "c".repeat(64),
      destinationPayloadKey: "d".repeat(64),
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      valid: true,
      publicationGuard,
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(__postingWorkerTestUtils.revalidateClaimedPostComposition(post, {
      clipId: "clip-1",
      sha256: "a".repeat(64),
      sizeBytes: 1_024,
    })).resolves.toEqual(publicationGuard);
    expect(post.idempotencyKey).toBe(publicationGuard.retryIdempotencyKey);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/scheduled-posts/post-1/validate-composition"),
      expect.objectContaining({
        method: "POST",
        body: expect.any(String),
      }),
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.compositionIdentities).toEqual([{
      ...post.clips[0]?.compositionIdentity,
      snapshotSha256: "a".repeat(64),
      snapshotSizeBytes: 1_024,
    }]);
  });

  it("fails closed when validation omits the approved-preview publication guard", async () => {
    const post = automationPost();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      valid: true,
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })));

    await expect(__postingWorkerTestUtils.revalidateClaimedPostComposition(post, {
      clipId: "clip-1",
      sha256: "a".repeat(64),
      sizeBytes: 1_024,
    })).rejects.toThrow("approved-preview publication guard");
    expect(post.idempotencyKey).toBe("post-1-key");
  });

  it("fails closed when the server releases a changed composition", async () => {
    const post = automationPost();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "The claimed clip composition is no longer current.",
      released: true,
    }), {
      status: 409,
      headers: { "content-type": "application/json" },
    })));

    await expect(__postingWorkerTestUtils.revalidateClaimedPostComposition(post, {
      clipId: "clip-1",
      sha256: "b".repeat(64),
      sizeBytes: 2_048,
    })).rejects.toMatchObject({
      name: "StaleClaimedCompositionError",
    });
  });
});
