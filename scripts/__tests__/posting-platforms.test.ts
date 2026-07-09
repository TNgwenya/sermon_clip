import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AmbiguousPlatformPublishError,
  buildDeterministicRequestId,
  buildFacebookText,
  buildTikTokInitBody,
  buildTikTokTitle,
  buildZernioPostRequest,
  buildYouTubeText,
  buildYouTubeUploadResult,
  extractHashtags,
  extractHashtagsFromText,
  selectYouTubeRefreshTokenSources,
  uploadPlatformPost,
  type AutomationPost,
} from "../posting-platforms";

const basePost: AutomationPost = {
  id: "post-1",
  socialAccountId: null,
  platform: "TikTok",
  title: "Sunday Sermon Clip",
  caption: "God is near when life feels loud.\n\n#Faith #Church",
  scheduledFor: new Date("2026-06-27T16:00:00.000Z").toISOString(),
  idempotencyKey: "post-1-tiktok",
  clips: [
    {
      id: "clip-1",
      title: "Jesus Meets Us In The Storm",
      caption: "Jesus meets us in the storm.",
      durationSeconds: 45,
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
    expect(extractHashtagsFromText("Keep going. #Faith #Hope #Faith")).toEqual(["#Faith", "#Hope"]);
  });

  it("builds YouTube title, description, and tags", () => {
    const text = buildYouTubeText({ ...basePost, platform: "YouTube Shorts" });

    expect(text.title).toBe("Sunday Sermon Clip");
    expect(text.description).toContain("God is near when life feels loud.");
    expect(text.description).toContain("#Faith #Church");
    expect(text.description).toBe(basePost.caption);
    expect(text.tags).toEqual(["Shorts", "Faith", "Church"]);
  });

  it("keeps private YouTube uploads in verification instead of calling them posted", () => {
    expect(buildYouTubeUploadResult({
      videoId: "youtube-1",
      requestedPrivacy: "private",
      apiVerified: true,
    })).toMatchObject({
      status: "PRIVATE_ONLY_UNVERIFIED",
      externalPostId: "youtube-1",
      finalPrivacyStatus: "private",
    });
    expect(buildYouTubeUploadResult({
      videoId: "youtube-2",
      requestedPrivacy: "public",
      apiVerified: true,
    }).status).toBe("POSTED");
  });

  it("prefers stored YouTube OAuth tokens before stale env fallback tokens", () => {
    expect(selectYouTubeRefreshTokenSources({
      hasSocialAccount: false,
      storedRefreshToken: "stored-refresh",
      envRefreshToken: "env-refresh",
    })).toEqual([
      { source: "stored", refreshToken: "stored-refresh" },
      { source: "env", refreshToken: "env-refresh" },
    ]);
  });

  it("does not fall back to env YouTube tokens for account-specific posts", () => {
    expect(selectYouTubeRefreshTokenSources({
      hasSocialAccount: true,
      storedRefreshToken: "stored-refresh",
      envRefreshToken: "env-refresh",
    })).toEqual([
      { source: "stored", refreshToken: "stored-refresh" },
    ]);
  });

  it("builds TikTok captions with hashtags inside the platform limit", () => {
    const title = buildTikTokTitle(basePost);

    expect(title).toBe(basePost.caption);
    expect(title.length).toBeLessThanOrEqual(2200);
  });

  it("publishes the saved platform caption without regenerating copy from clip metadata", () => {
    const editedCaption = "A media-team edit with a different emphasis.\n\n#SundayWord";
    const editedPost = { ...basePost, caption: editedCaption };

    expect(buildTikTokTitle(editedPost)).toBe(editedCaption);
    expect(buildYouTubeText({ ...editedPost, platform: "YouTube Shorts" }).description).toBe(editedCaption);
    expect(buildFacebookText({ ...editedPost, platform: "Facebook" }).description).toBe(editedCaption);
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

  it("builds deterministic UUID request ids for safe Zernio retries", () => {
    const first = buildDeterministicRequestId("post-1-tiktok");
    const second = buildDeterministicRequestId("post-1-tiktok");

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("builds a Zernio TikTok post request with public media", () => {
    const request = buildZernioPostRequest({
      ...basePost,
      socialAccountExternalProvider: "zernio",
      socialAccountExternalPlatform: "tiktok",
      socialAccountExternalAccountId: "zernio-tiktok-1",
      mediaPublicUrl: "https://media.example.com/posting-temp/post-1/clip-1.mp4",
    }, 1024);

    expect(request).toMatchObject({
      content: expect.stringContaining("God is near when life feels loud."),
      mediaItems: [{
        type: "video",
        url: "https://media.example.com/posting-temp/post-1/clip-1.mp4",
        title: "Sunday Sermon Clip",
        filename: "post-1.mp4",
        size: 1024,
        mimeType: "video/mp4",
      }],
      platforms: [{
        platform: "tiktok",
        accountId: "zernio-tiktok-1",
      }],
      publishNow: true,
      metadata: {
        sermonClipScheduledPostId: "post-1",
        sermonClipClipIds: ["clip-1"],
        sermonClipIdempotencyKey: "post-1-tiktok",
      },
    });
    expect(request.content.length).toBeLessThanOrEqual(2200);
  });

  it("omits TikTok privacy level unless explicitly configured", () => {
    vi.stubEnv("ZERNIO_TIKTOK_PRIVACY_LEVEL", "");

    const request = buildZernioPostRequest({
      ...basePost,
      socialAccountExternalProvider: "zernio",
      socialAccountExternalPlatform: "tiktok",
      socialAccountExternalAccountId: "zernio-tiktok-1",
      mediaPublicUrl: "https://media.example.com/clip.mp4",
    }, 1024);

    expect(request.platforms[0]?.platformSpecificData).toBeUndefined();
  });

  it("adds TikTok privacy level when configured", () => {
    vi.stubEnv("ZERNIO_TIKTOK_PRIVACY_LEVEL", "SELF_ONLY");

    const request = buildZernioPostRequest({
      ...basePost,
      socialAccountExternalProvider: "zernio",
      socialAccountExternalPlatform: "tiktok",
      socialAccountExternalAccountId: "zernio-tiktok-1",
      mediaPublicUrl: "https://media.example.com/clip.mp4",
    }, 1024);

    expect(request.platforms[0]?.platformSpecificData).toEqual({ privacyLevel: "SELF_ONLY" });
  });

  it("requires a synced Zernio account for Zernio publishing", () => {
    expect(() => buildZernioPostRequest({
      ...basePost,
      mediaPublicUrl: "https://media.example.com/clip.mp4",
    }, 1024)).toThrow("Connect and sync a Zernio TikTok account");
  });

  it("blocks Instagram automatic posting above 60 seconds", () => {
    expect(() => buildZernioPostRequest({
      ...basePost,
      platform: "Instagram",
      socialAccountExternalProvider: "zernio",
      socialAccountExternalPlatform: "instagram",
      socialAccountExternalAccountId: "zernio-instagram-1",
      mediaPublicUrl: "https://media.example.com/clip.mp4",
      clips: [{
        ...basePost.clips[0]!,
        durationSeconds: 61,
      }],
    }, 1024)).toThrow("60 seconds or less");
  });

  it("builds Facebook Page video text with safe unpublished default", () => {
    vi.stubEnv("FACEBOOK_DEFAULT_PUBLISHED", "");

    const text = buildFacebookText({ ...basePost, platform: "Facebook" });

    expect(text).toEqual({
      title: "Sunday Sermon Clip",
      description: basePost.caption,
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
      if (String(input).includes("/me/accounts")) {
        return Response.json({ data: [] });
      }

      return Response.json({ id: "fb-video-1" });
    };

    try {
      const result = await uploadPlatformPost({ ...basePost, platform: "Facebook" }, videoPath, 5, fetchImpl);
      const uploadRequest = capturedRequests.at(-1);
      expect(uploadRequest).toBeDefined();
      const [url, init] = uploadRequest!;
      const body = init?.body as FormData;

      expect(url).toBe("https://graph.facebook.com/v99.0/page-123/videos");
      expect(init?.method).toBe("POST");
      expect(body.get("access_token")).toBe("page-token");
      expect(body.get("title")).toBe("Sunday Sermon Clip");
      expect(body.get("published")).toBe("true");
      expect(body.get("description")).toContain("#Faith #Church");
      expect(result).toEqual({
        status: "PRIVATE_ONLY_UNVERIFIED",
        externalPostId: "fb-video-1",
        publishedUrl: "https://www.facebook.com/fb-video-1",
        finalPrivacyStatus: "published",
        publishError: "Facebook accepted the video with publishing requested, but public availability has not been confirmed. Check the Page before marking it posted.",
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("keeps unpublished Facebook uploads in verification", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "facebook-upload-"));
    const videoPath = join(tempDir, "clip.mp4");
    await writeFile(videoPath, Buffer.from("video"));
    vi.stubEnv("FACEBOOK_PAGE_ID", "page-123");
    vi.stubEnv("FACEBOOK_PAGE_ACCESS_TOKEN", "page-token");
    vi.stubEnv("FACEBOOK_DEFAULT_PUBLISHED", "");
    const fetchImpl: typeof fetch = async (input) => String(input).includes("/me/accounts")
      ? Response.json({ data: [] })
      : Response.json({ id: "fb-private-1" });

    try {
      const result = await uploadPlatformPost({ ...basePost, platform: "Facebook" }, videoPath, 5, fetchImpl);
      expect(result).toMatchObject({
        status: "PRIVATE_ONLY_UNVERIFIED",
        externalPostId: "fb-private-1",
        finalPrivacyStatus: "unpublished",
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("treats a lost Facebook upload response as ambiguous", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "facebook-upload-"));
    const videoPath = join(tempDir, "clip.mp4");
    await writeFile(videoPath, Buffer.from("video"));
    vi.stubEnv("FACEBOOK_PAGE_ID", "page-123");
    vi.stubEnv("FACEBOOK_PAGE_ACCESS_TOKEN", "page-token");
    const fetchImpl: typeof fetch = async (input) => {
      if (String(input).includes("/me/accounts")) {
        return Response.json({ data: [] });
      }
      throw new TypeError("connection closed");
    };

    try {
      await expect(uploadPlatformPost({ ...basePost, platform: "Facebook" }, videoPath, 5, fetchImpl))
        .rejects.toBeInstanceOf(AmbiguousPlatformPublishError);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("derives a Facebook Page token from a configured user token", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "facebook-upload-"));
    const videoPath = join(tempDir, "clip.mp4");
    await writeFile(videoPath, Buffer.from("video"));
    vi.stubEnv("FACEBOOK_PAGE_ID", "page-123");
    vi.stubEnv("FACEBOOK_PAGE_ACCESS_TOKEN", "user-token");
    vi.stubEnv("FACEBOOK_GRAPH_VERSION", "v99.0");
    const capturedRequests: Array<[input: RequestInfo | URL, init?: RequestInit]> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      capturedRequests.push([input, init]);
      if (String(input).includes("/me/accounts")) {
        return Response.json({
          data: [
            { id: "page-123", access_token: "derived-page-token" },
          ],
        });
      }

      return Response.json({ id: "fb-video-1" });
    };

    try {
      await uploadPlatformPost({ ...basePost, platform: "Facebook" }, videoPath, 5, fetchImpl);
      const uploadRequest = capturedRequests.at(-1);
      expect(uploadRequest).toBeDefined();
      const [, init] = uploadRequest!;
      const body = init?.body as FormData;

      expect(body.get("access_token")).toBe("derived-page-token");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("routes Instagram through the Zernio media URL requirement", async () => {
    await expect(uploadPlatformPost({ ...basePost, platform: "Instagram" }, "/tmp/clip.mp4", 25))
      .rejects.toThrow("A public R2 media URL is required");
  });

  it("posts TikTok videos through Zernio", async () => {
    vi.stubEnv("ZERNIO_API_KEY", "zernio-key");
    const capturedRequests: Array<[input: RequestInfo | URL, init?: RequestInit]> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      capturedRequests.push([input, init]);
      return Response.json({
        post: {
          _id: "zernio-post-1",
          status: "published",
          platforms: [{
            platform: "tiktok",
            status: "published",
            platformPostUrl: "https://www.tiktok.com/@church/video/1",
          }],
        },
      }, { status: 201 });
    };

    const result = await uploadPlatformPost({
      ...basePost,
      socialAccountExternalProvider: "zernio",
      socialAccountExternalPlatform: "tiktok",
      socialAccountExternalAccountId: "zernio-tiktok-1",
      mediaPublicUrl: "https://media.example.com/clip.mp4",
    }, "/tmp/clip.mp4", 25, fetchImpl);

    expect(capturedRequests[0]?.[0]).toBe("https://zernio.com/api/v1/posts");
    expect(capturedRequests[0]?.[1]?.method).toBe("POST");
    expect(new Headers(capturedRequests[0]?.[1]?.headers).get("authorization")).toBe("Bearer zernio-key");
    expect(result).toEqual({
      status: "POSTED",
      externalPostId: "zernio-post-1",
      publishedUrl: "https://www.tiktok.com/@church/video/1",
      finalPrivacyStatus: "published",
    });
  });

  it("keeps accepted Zernio posts in verification until publication is confirmed", async () => {
    vi.stubEnv("ZERNIO_API_KEY", "zernio-key");
    const fetchImpl: typeof fetch = async () => Response.json({
      post: {
        _id: "zernio-post-processing",
        status: "processing",
        platforms: [{ platform: "tiktok", status: "processing" }],
      },
    }, { status: 201 });

    const result = await uploadPlatformPost({
      ...basePost,
      socialAccountExternalProvider: "zernio",
      socialAccountExternalPlatform: "tiktok",
      socialAccountExternalAccountId: "zernio-tiktok-1",
      mediaPublicUrl: "https://media.example.com/clip.mp4",
    }, "/tmp/clip.mp4", 25, fetchImpl);

    expect(result).toMatchObject({
      status: "PRIVATE_ONLY_UNVERIFIED",
      externalPostId: "zernio-post-processing",
      finalPrivacyStatus: "processing",
    });
  });

  it("treats a lost Zernio create response as ambiguous", async () => {
    vi.stubEnv("ZERNIO_API_KEY", "zernio-key");
    const fetchImpl: typeof fetch = async () => {
      throw new TypeError("connection closed");
    };

    await expect(uploadPlatformPost({
      ...basePost,
      socialAccountExternalProvider: "zernio",
      socialAccountExternalPlatform: "tiktok",
      socialAccountExternalAccountId: "zernio-tiktok-1",
      mediaPublicUrl: "https://media.example.com/clip.mp4",
    }, "/tmp/clip.mp4", 25, fetchImpl)).rejects.toBeInstanceOf(AmbiguousPlatformPublishError);
  });

  it("treats retryable Zernio server responses as ambiguous", async () => {
    vi.stubEnv("ZERNIO_API_KEY", "zernio-key");
    const fetchImpl: typeof fetch = async () => Response.json({ error: "Publisher unavailable" }, { status: 503 });

    await expect(uploadPlatformPost({
      ...basePost,
      socialAccountExternalProvider: "zernio",
      socialAccountExternalPlatform: "tiktok",
      socialAccountExternalAccountId: "zernio-tiktok-1",
      mediaPublicUrl: "https://media.example.com/clip.mp4",
    }, "/tmp/clip.mp4", 25, fetchImpl)).rejects.toBeInstanceOf(AmbiguousPlatformPublishError);
  });

  it("treats a successful Zernio response without a post record as ambiguous", async () => {
    vi.stubEnv("ZERNIO_API_KEY", "zernio-key");
    const fetchImpl: typeof fetch = async () => Response.json({}, { status: 201 });

    await expect(uploadPlatformPost({
      ...basePost,
      socialAccountExternalProvider: "zernio",
      socialAccountExternalPlatform: "tiktok",
      socialAccountExternalAccountId: "zernio-tiktok-1",
      mediaPublicUrl: "https://media.example.com/clip.mp4",
    }, "/tmp/clip.mp4", 25, fetchImpl)).rejects.toBeInstanceOf(AmbiguousPlatformPublishError);
  });

  it("resolves Zernio duplicate responses when the existing post is already published", async () => {
    vi.stubEnv("ZERNIO_API_KEY", "zernio-key");
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/v1/posts")) {
        return Response.json({
          error: "This exact content is already scheduled, publishing, or was posted to this account within the last 24 hours.",
          details: {
            existingPostId: "existing-post-1",
          },
        }, { status: 409 });
      }

      return Response.json({
        post: {
          _id: "existing-post-1",
          status: "published",
          platforms: [{
            platform: "instagram",
            status: "published",
            platformPostUrl: "https://www.instagram.com/reel/1/",
          }],
        },
      });
    };

    const result = await uploadPlatformPost({
      ...basePost,
      platform: "Instagram",
      socialAccountExternalProvider: "zernio",
      socialAccountExternalPlatform: "instagram",
      socialAccountExternalAccountId: "zernio-instagram-1",
      mediaPublicUrl: "https://media.example.com/clip.mp4",
    }, "/tmp/clip.mp4", 25, fetchImpl);

    expect(result).toEqual({
      status: "POSTED",
      externalPostId: "existing-post-1",
      publishedUrl: "https://www.instagram.com/reel/1/",
      finalPrivacyStatus: "published",
    });
  });

  it("does not retry a Zernio duplicate that is still processing", async () => {
    vi.stubEnv("ZERNIO_API_KEY", "zernio-key");
    const fetchImpl: typeof fetch = async (input) => {
      if (String(input).endsWith("/v1/posts")) {
        return Response.json({
          error: "Duplicate request",
          details: { existingPostId: "existing-processing-1" },
        }, { status: 409 });
      }

      return Response.json({
        post: {
          _id: "existing-processing-1",
          status: "processing",
          platforms: [{ platform: "tiktok", status: "processing" }],
        },
      });
    };

    const result = await uploadPlatformPost({
      ...basePost,
      socialAccountExternalProvider: "zernio",
      socialAccountExternalPlatform: "tiktok",
      socialAccountExternalAccountId: "zernio-tiktok-1",
      mediaPublicUrl: "https://media.example.com/clip.mp4",
    }, "/tmp/clip.mp4", 25, fetchImpl);

    expect(result).toMatchObject({
      status: "PRIVATE_ONLY_UNVERIFIED",
      externalPostId: "existing-processing-1",
      finalPrivacyStatus: "processing",
    });
  });
});
