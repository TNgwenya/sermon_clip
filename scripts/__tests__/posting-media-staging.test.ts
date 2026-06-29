import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildPostingMediaObjectKey,
  buildR2PublicUrl,
} from "../posting-media-staging";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("posting media staging", () => {
  it("builds stable R2 object keys for temporary posting media", () => {
    expect(buildPostingMediaObjectKey({
      scheduledPostId: "post 1",
      clipId: "clip/1",
      filename: "/tmp/export.mp4",
    })).toBe("posting-temp/post-1/clip-1.mp4");
  });

  it("builds public HTTPS URLs for R2 objects", () => {
    vi.stubEnv("R2_PUBLIC_BASE_URL", "https://media.example.com/");

    expect(buildR2PublicUrl("posting-temp/post-1/clip-1.mp4"))
      .toBe("https://media.example.com/posting-temp/post-1/clip-1.mp4");
  });

  it("rejects non-HTTPS public media bases", () => {
    vi.stubEnv("R2_PUBLIC_BASE_URL", "http://media.example.com");

    expect(() => buildR2PublicUrl("posting-temp/post-1/clip-1.mp4")).toThrow("HTTPS");
  });
});
