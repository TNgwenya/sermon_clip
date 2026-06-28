import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildFacebookText,
  buildTikTokInitBody,
  buildTikTokTitle,
  buildYouTubeText,
  extractHashtags,
  uploadPlatformPost,
  type AutomationPost,
} from "../posting-platforms";

const basePost: AutomationPost = {
  id: "post-1",
  platform: "TikTok",
  title: "Sunday Sermon Clip",
  caption: "God is near when life feels loud.",
  scheduledFor: new Date("2026-06-27T16:00:00.000Z").toISOString(),
  idempotencyKey: "post-1-tiktok",
  clips: [
    {
      id: "clip-1",
      title: "Jesus Meets Us In The Storm",
      caption: "Jesus meets us in the storm.",
      hashtags: ["Faith", "#Church", ""],
      localFileCandidates: ["/tmp/clip.mp4"],
      sermon: {
        title: "Sunday Sermon",
        churchName: "Grace Church",
      },
    },
  ],
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("posting platform helpers", () => {
  it("normalizes hashtags", () => {
    expect(extractHashtags(["Faith", "#Church", "", 42])).toEqual(["#Faith", "#Church"]);
  });

  it("builds YouTube title, description, and tags", () => {
    const text = buildYouTubeText({ ...basePost, platform: "YouTube Shorts" });

    expect(text.title).toBe("Sunday Sermon Clip");
    expect(text.description).toContain("God is near when life feels loud.");
    expect(text.description).toContain("#Faith #Church");
    expect(text.description).toContain("From Grace Church");
    expect(text.tags).toEqual(["Shorts", "Faith", "Church"]);
  });

  it("builds TikTok captions with hashtags inside the platform limit", () => {
    const title = buildTikTokTitle(basePost);

    expect(title).toContain("God is near when life feels loud.");
    expect(title).toContain("#Faith #Church");
    expect(title.length).toBeLessThanOrEqual(2200);
  });

  it("builds TikTok direct-upload metadata with chunk counts", () => {
    vi.stubEnv("TIKTOK_UPLOAD_CHUNK_BYTES", String(10));
    vi.stubEnv("TIKTOK_DEFAULT_PRIVACY_LEVEL", "SELF_ONLY");

    const body = buildTikTokInitBody(basePost, 25);

    expect(body).toMatchObject({
      post_info: {
        privacy_level: "SELF_ONLY",
        disable_duet: true,
        disable_comment: true,
        disable_stitch: true,
      },
      source_info: {
        source: "FILE_UPLOAD",
        video_size: 25,
        chunk_size: 10,
        total_chunk_count: 3,
      },
    });
  });

  it("builds Facebook Page video text with safe unpublished default", () => {
    const text = buildFacebookText({ ...basePost, platform: "Facebook" });

    expect(text).toEqual({
      title: "Sunday Sermon Clip",
      description: "God is near when life feels loud.\n\n#Faith #Church\n\nFrom Grace Church",
      published: false,
    });
  });

  it("uploads Facebook videos to the configured Page endpoint", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "facebook-upload-"));
    const videoPath = join(tempDir, "clip.mp4");
    await writeFile(videoPath, Buffer.from("video"));
    vi.stubEnv("FACEBOOK_PAGE_ID", "page-123");
    vi.stubEnv("FACEBOOK_PAGE_ACCESS_TOKEN", "page-token");
    vi.stubEnv("FACEBOOK_GRAPH_VERSION", "v99.0");
    vi.stubEnv("FACEBOOK_DEFAULT_PUBLISHED", "true");
    const capturedRequests: Array<[input: RequestInfo | URL, init?: RequestInit]> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      capturedRequests.push([input, init]);
      return Response.json({ id: "fb-video-1" });
    };

    try {
      const result = await uploadPlatformPost({ ...basePost, platform: "Facebook" }, videoPath, 5, fetchImpl);
      const firstRequest = capturedRequests[0];
      expect(firstRequest).toBeDefined();
      const [url, init] = firstRequest;
      const body = init?.body as FormData;

      expect(url).toBe("https://graph.facebook.com/v99.0/page-123/videos");
      expect(init?.method).toBe("POST");
      expect(body.get("access_token")).toBe("page-token");
      expect(body.get("title")).toBe("Sunday Sermon Clip");
      expect(body.get("published")).toBe("true");
      expect(body.get("description")).toContain("#Faith #Church");
      expect(result).toEqual({
        status: "POSTED",
        externalPostId: "fb-video-1",
        publishedUrl: "https://www.facebook.com/fb-video-1",
        finalPrivacyStatus: "published",
        publishError: undefined,
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("keeps unsupported automatic platforms explicit", async () => {
    await expect(uploadPlatformPost({ ...basePost, platform: "Instagram" }, "/tmp/clip.mp4", 25))
      .rejects.toThrow("Instagram automatic posting needs a public video URL");
  });
});
