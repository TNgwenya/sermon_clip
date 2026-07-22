import { describe, expect, it } from "vitest";

import {
  __clipRemotePreviewStorageTestUtils,
  buildClipPreviewObjectKey,
  isClipPreviewObjectKeyForSermon,
  isPostingMediaObjectKeyForScheduledPost,
} from "@/server/agents/clipRemotePreviewStorage";

describe("clip remote preview storage", () => {
  it("builds sermon-scoped preview object keys", () => {
    expect(buildClipPreviewObjectKey({
      sermonId: "sermon 1",
      clipId: "clip/1",
      filename: "preview.mp4",
    })).toBe("clip-previews/sermon-1/clip-1.mp4");
  });

  it("uploads versioned playback media with long-lived browser cache metadata", () => {
    expect(__clipRemotePreviewStorageTestUtils.buildClipPreviewUploadMetadata({
      videoSize: 1_234,
    })).toEqual({
      ContentLength: 1_234,
      ContentType: "video/mp4",
      CacheControl: "public, max-age=31536000, immutable",
      ContentDisposition: "inline",
    });
    expect(__clipRemotePreviewStorageTestUtils.buildClipPreviewPublicVersion(
      "compact-v1",
      new Date("2026-07-22T10:00:00.000Z"),
    )).toBe("compact-v1-1784714400000");
  });

  it("only accepts preview object keys scoped to the sermon being deleted", () => {
    expect(isClipPreviewObjectKeyForSermon({
      sermonId: "sermon-1",
      objectKey: "clip-previews/sermon-1/clip-1.mp4",
    })).toBe(true);

    expect(isClipPreviewObjectKeyForSermon({
      sermonId: "sermon-1",
      objectKey: "clip-previews/sermon-2/clip-1.mp4",
    })).toBe(false);

    expect(isClipPreviewObjectKeyForSermon({
      sermonId: "sermon-1",
      objectKey: "exports/sermon-1/clip-1.mp4",
    })).toBe(false);
  });

  it("only accepts posting media object keys scoped to the scheduled post being deleted", () => {
    expect(isPostingMediaObjectKeyForScheduledPost({
      scheduledPostId: "post-1",
      objectKey: "posting-temp/post-1/clip-1.mp4",
    })).toBe(true);

    expect(isPostingMediaObjectKeyForScheduledPost({
      scheduledPostId: "post-1",
      objectKey: "posting-temp/post-2/clip-1.mp4",
    })).toBe(false);

    expect(isPostingMediaObjectKeyForScheduledPost({
      scheduledPostId: "post-1",
      objectKey: "clip-previews/post-1/clip-1.mp4",
    })).toBe(false);
  });
});
