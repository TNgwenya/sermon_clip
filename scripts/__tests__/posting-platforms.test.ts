import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import crypto from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

const credentialFindFirst = vi.hoisted(() => vi.fn());
const credentialUpdate = vi.hoisted(() => vi.fn());

vi.mock("@prisma/client", () => ({
  PrismaClient: class {
    socialCredential = {
      findFirst: credentialFindFirst,
      update: credentialUpdate,
    };
  },
}));

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
  selectPostImageMedia,
  selectYouTubeRefreshTokenSources,
  resolveTikTokPostingProvider,
  postingRequiresPublicMedia,
  uploadFacebookImages,
  uploadInstagramImages,
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

function imagePost(input: {
  platform: "Facebook" | "Instagram";
  assetType?: string;
  files?: Array<{
    id: string;
    fileName: string;
    mimeType: string;
    publicUrl: string | null;
    sortOrder: number;
  }>;
}): AutomationPost {
  return {
    ...basePost,
    platform: input.platform,
    clips: [],
    contentAssets: [{
      id: "asset-1",
      title: "Faith in the waiting",
      assetType: input.assetType ?? "QUOTE_GRAPHIC",
      status: "SCHEDULED",
      caption: "Faithful steps matter.",
      bodyContent: null,
      callToAction: "Join us Sunday.",
      hashtags: ["Faith"],
      files: (input.files ?? [{
        id: "image-1",
        fileName: "portrait.jpg",
        mimeType: "image/jpeg",
        publicUrl: "https://media.example.com/portrait.jpg",
        sortOrder: 0,
      }]).map((file) => ({
        ...file,
        filePath: null,
        objectKey: null,
        width: 1080,
        height: 1350,
        sizeBytes: "42000",
        metadata: null,
      })),
    }],
  };
}

function encryptStoredToken(value: string, secret: string): string {
  const iv = crypto.randomBytes(12);
  const key = crypto.createHash("sha256").update(secret).digest();
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);

  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

afterEach(() => {
  vi.unstubAllEnvs();
  credentialFindFirst.mockReset();
  credentialUpdate.mockReset();
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

  it("selects one JPEG publishing variant for graphics and ordered JPEG slides for carousels", () => {
    const graphic = imagePost({
      platform: "Instagram",
      files: [
        { id: "png-square", fileName: "square.png", mimeType: "image/png", publicUrl: "https://media.example.com/square.png", sortOrder: 0 },
        { id: "png-portrait", fileName: "portrait.png", mimeType: "image/png", publicUrl: "https://media.example.com/portrait.png", sortOrder: 1 },
        { id: "jpg-square", fileName: "square.jpg", mimeType: "image/jpeg", publicUrl: "https://media.example.com/square.jpg", sortOrder: 2 },
        { id: "jpg-portrait", fileName: "portrait.jpg", mimeType: "image/jpeg", publicUrl: "https://media.example.com/portrait.jpg", sortOrder: 3 },
      ],
    });
    const carousel = imagePost({
      platform: "Instagram",
      assetType: "CAROUSEL",
      files: [
        { id: "png-1", fileName: "carousel/slide-01.png", mimeType: "image/png", publicUrl: "https://media.example.com/slide-01.png", sortOrder: 0 },
        { id: "png-2", fileName: "carousel/slide-02.png", mimeType: "image/png", publicUrl: "https://media.example.com/slide-02.png", sortOrder: 1 },
        { id: "jpg-1", fileName: "carousel/slide-01.jpg", mimeType: "image/jpeg", publicUrl: "https://media.example.com/slide-01.jpg", sortOrder: 2 },
        { id: "jpg-2", fileName: "carousel/slide-02.jpg", mimeType: "image/jpeg", publicUrl: "https://media.example.com/slide-02.jpg", sortOrder: 3 },
      ],
    });

    expect(selectPostImageMedia(graphic).map((file) => file.id)).toEqual(["jpg-portrait"]);
    expect(selectPostImageMedia(carousel).map((file) => file.id)).toEqual(["jpg-1", "jpg-2"]);
  });

  it("publishes a Facebook Page single image from a public URL", async () => {
    vi.stubEnv("FACEBOOK_PAGE_ID", "page-123");
    vi.stubEnv("FACEBOOK_PAGE_ACCESS_TOKEN", "page-token");
    vi.stubEnv("FACEBOOK_GRAPH_VERSION", "v99.0");
    vi.stubEnv("FACEBOOK_DEFAULT_PUBLISHED", "true");
    const requests: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push([input, init]);
      return String(input).includes("/me/accounts")
        ? Response.json({ data: [] })
        : Response.json({ id: "photo-1", post_id: "page-123_post-1" });
    };

    const result = await uploadFacebookImages(imagePost({ platform: "Facebook" }), undefined, fetchImpl);
    const [, init] = requests.at(-1)!;
    const body = init?.body as FormData;

    expect(String(requests.at(-1)?.[0])).toBe("https://graph.facebook.com/v99.0/page-123/photos");
    expect(body.get("url")).toBe("https://media.example.com/portrait.jpg");
    expect(body.get("message")).toBe(basePost.caption);
    expect(body.get("published")).toBe("true");
    expect(result).toEqual({
      status: "POSTED",
      externalPostId: "page-123_post-1",
      publishedUrl: "https://www.facebook.com/page-123_post-1",
      finalPrivacyStatus: "published",
    });
  });

  it("does not fall back to Facebook env credentials when the selected account has no stored credential", async () => {
    vi.stubEnv("FACEBOOK_PAGE_ID", "env-page");
    vi.stubEnv("FACEBOOK_PAGE_ACCESS_TOKEN", "env-token");
    credentialFindFirst.mockResolvedValue(null);
    const fetchImpl = vi.fn<typeof fetch>();
    const post = {
      ...imagePost({ platform: "Facebook" }),
      socialAccountId: "selected-facebook-account",
    };

    await expect(uploadFacebookImages(post, undefined, fetchImpl))
      .rejects.toThrow("selected Facebook account does not have a connected credential");
    expect(credentialFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        provider: "META_FACEBOOK",
        socialAccountId: "selected-facebook-account",
      }),
    }));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("propagates selected Facebook credential lookup errors instead of using env credentials", async () => {
    vi.stubEnv("FACEBOOK_PAGE_ID", "env-page");
    vi.stubEnv("FACEBOOK_PAGE_ACCESS_TOKEN", "env-token");
    credentialFindFirst.mockRejectedValue(new Error("credential database unavailable"));
    const fetchImpl = vi.fn<typeof fetch>();
    const post = {
      ...imagePost({ platform: "Facebook" }),
      socialAccountId: "selected-facebook-account",
    };

    await expect(uploadFacebookImages(post, undefined, fetchImpl))
      .rejects.toThrow("credential database unavailable");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not use Facebook env credentials when the selected stored credential is expired", async () => {
    const secret = "posting-platform-test-secret";
    vi.stubEnv("AUTH_SECRET", secret);
    vi.stubEnv("FACEBOOK_PAGE_ID", "env-page");
    vi.stubEnv("FACEBOOK_PAGE_ACCESS_TOKEN", "env-token");
    credentialFindFirst.mockResolvedValue({
      id: "credential-1",
      provider: "META_FACEBOOK",
      externalAccountId: "stored-page",
      accessTokenCiphertext: encryptStoredToken("stored-token", secret),
      refreshTokenCiphertext: null,
      expiresAt: new Date(Date.now() - 60_000),
    });
    const fetchImpl = vi.fn<typeof fetch>();
    const post = {
      ...imagePost({ platform: "Facebook" }),
      socialAccountId: "selected-facebook-account",
    };

    await expect(uploadFacebookImages(post, undefined, fetchImpl))
      .rejects.toThrow("selected Facebook account credential has expired");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("publishes Facebook multi-image posts by attaching unpublished photo ids", async () => {
    vi.stubEnv("FACEBOOK_PAGE_ID", "page-123");
    vi.stubEnv("FACEBOOK_PAGE_ACCESS_TOKEN", "page-token");
    vi.stubEnv("FACEBOOK_DEFAULT_PUBLISHED", "true");
    let photoNumber = 0;
    const requests: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push([input, init]);
      const url = String(input);
      if (url.includes("/me/accounts")) return Response.json({ data: [] });
      if (url.endsWith("/photos")) return Response.json({ id: `photo-${++photoNumber}` });
      return Response.json({ id: "page-123_feed-1" });
    };
    const post = imagePost({
      platform: "Facebook",
      assetType: "CAROUSEL",
      files: [
        { id: "slide-1", fileName: "slide-01.jpg", mimeType: "image/jpeg", publicUrl: "https://media.example.com/slide-01.jpg", sortOrder: 0 },
        { id: "slide-2", fileName: "slide-02.jpg", mimeType: "image/jpeg", publicUrl: "https://media.example.com/slide-02.jpg", sortOrder: 1 },
      ],
    });

    const result = await uploadFacebookImages(post, undefined, fetchImpl);
    const photoRequests = requests.filter(([input]) => String(input).endsWith("/photos"));
    const feedRequest = requests.find(([input]) => String(input).endsWith("/feed"));

    expect(photoRequests).toHaveLength(2);
    expect((photoRequests[0]?.[1]?.body as FormData).get("published")).toBe("false");
    expect(feedRequest).toBeDefined();
    const feedBody = feedRequest?.[1]?.body as URLSearchParams;
    expect(feedBody.get("attached_media[0]")).toBe(JSON.stringify({ media_fbid: "photo-1" }));
    expect(feedBody.get("attached_media[1]")).toBe(JSON.stringify({ media_fbid: "photo-2" }));
    expect(result.status).toBe("POSTED");
    expect(result.externalPostId).toBe("page-123_feed-1");
  });

  it("creates, polls, publishes, and resolves an Instagram single image", async () => {
    vi.stubEnv("INSTAGRAM_ACCOUNT_ID", "ig-123");
    vi.stubEnv("INSTAGRAM_ACCESS_TOKEN", "ig-token");
    vi.stubEnv("INSTAGRAM_GRAPH_VERSION", "v99.0");
    vi.stubEnv("INSTAGRAM_CONTAINER_POLL_INTERVAL_MS", "0");
    const requests: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push([input, init]);
      const url = String(input);
      if (init?.method === "POST" && url.endsWith("/media")) return Response.json({ id: "container-1" });
      if (url.includes("/container-1?")) return Response.json({ status_code: "FINISHED" });
      if (init?.method === "POST" && url.endsWith("/media_publish")) return Response.json({ id: "ig-media-1" });
      return Response.json({ permalink: "https://www.instagram.com/p/one/" });
    };

    const result = await uploadInstagramImages(imagePost({ platform: "Instagram" }), undefined, fetchImpl);
    const createBody = requests[0]?.[1]?.body as URLSearchParams;

    expect(requests[0]?.[0]).toBe("https://graph.facebook.com/v99.0/ig-123/media");
    expect(createBody.get("image_url")).toBe("https://media.example.com/portrait.jpg");
    expect(createBody.get("caption")).toBe(basePost.caption);
    expect(result).toEqual({
      status: "POSTED",
      externalPostId: "ig-media-1",
      publishedUrl: "https://www.instagram.com/p/one/",
      finalPrivacyStatus: "published",
    });
  });

  it("does not fall back to Instagram env credentials when the selected account has no stored credential", async () => {
    vi.stubEnv("INSTAGRAM_ACCOUNT_ID", "env-instagram");
    vi.stubEnv("INSTAGRAM_ACCESS_TOKEN", "env-token");
    credentialFindFirst.mockResolvedValue(null);
    const fetchImpl = vi.fn<typeof fetch>();
    const post = {
      ...imagePost({ platform: "Instagram" }),
      socialAccountId: "selected-instagram-account",
    };

    await expect(uploadInstagramImages(post, undefined, fetchImpl))
      .rejects.toThrow("selected Instagram account does not have a connected credential");
    expect(credentialFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        provider: "META_INSTAGRAM",
        socialAccountId: "selected-instagram-account",
      }),
    }));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("creates ordered Instagram child containers and publishes a carousel", async () => {
    vi.stubEnv("INSTAGRAM_ACCOUNT_ID", "ig-123");
    vi.stubEnv("INSTAGRAM_ACCESS_TOKEN", "ig-token");
    vi.stubEnv("INSTAGRAM_CONTAINER_POLL_INTERVAL_MS", "0");
    let childCount = 0;
    const createBodies: URLSearchParams[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (init?.method === "POST" && url.endsWith("/media")) {
        const body = init.body as URLSearchParams;
        createBodies.push(body);
        return body.get("media_type") === "CAROUSEL"
          ? Response.json({ id: "carousel-parent" })
          : Response.json({ id: `carousel-child-${++childCount}` });
      }
      if (url.includes("fields=status_code")) return Response.json({ status_code: "FINISHED" });
      if (init?.method === "POST" && url.endsWith("/media_publish")) return Response.json({ id: "ig-carousel-1" });
      return Response.json({ permalink: "https://www.instagram.com/p/carousel/" });
    };
    const post = imagePost({
      platform: "Instagram",
      assetType: "CAROUSEL",
      files: [
        { id: "slide-1", fileName: "slide-01.jpg", mimeType: "image/jpeg", publicUrl: "https://media.example.com/slide-01.jpg", sortOrder: 0 },
        { id: "slide-2", fileName: "slide-02.jpg", mimeType: "image/jpeg", publicUrl: "https://media.example.com/slide-02.jpg", sortOrder: 1 },
      ],
    });

    const result = await uploadInstagramImages(post, undefined, fetchImpl);

    expect(createBodies).toHaveLength(3);
    expect(createBodies[0]?.get("is_carousel_item")).toBe("true");
    expect(createBodies[1]?.get("is_carousel_item")).toBe("true");
    expect(createBodies[2]?.get("media_type")).toBe("CAROUSEL");
    expect(createBodies[2]?.get("children")).toBe("carousel-child-1,carousel-child-2");
    expect(result).toMatchObject({ status: "POSTED", externalPostId: "ig-carousel-1" });
  });

  it("does not retry an Instagram publish whose final response was lost", async () => {
    vi.stubEnv("INSTAGRAM_ACCOUNT_ID", "ig-123");
    vi.stubEnv("INSTAGRAM_ACCESS_TOKEN", "ig-token");
    vi.stubEnv("INSTAGRAM_CONTAINER_POLL_INTERVAL_MS", "0");
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (init?.method === "POST" && url.endsWith("/media")) return Response.json({ id: "container-1" });
      if (url.includes("fields=status_code")) return Response.json({ status_code: "FINISHED" });
      throw new TypeError("connection closed");
    };

    await expect(uploadInstagramImages(imagePost({ platform: "Instagram" }), undefined, fetchImpl))
      .rejects.toBeInstanceOf(AmbiguousPlatformPublishError);
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

  it("uses TikTok Direct Post for a directly connected account", async () => {
    vi.stubEnv("TIKTOK_POSTING_PROVIDER", "direct");
    vi.stubEnv("TIKTOK_DIRECT_POST_EXPERIMENTAL", "true");
    vi.stubEnv("TIKTOK_ACCESS_TOKEN", "direct-token");
    const tempDir = await mkdtemp(join(tmpdir(), "sermon-clip-tiktok-direct-"));
    const videoPath = join(tempDir, "clip.mp4");
    await writeFile(videoPath, Buffer.from("video"));
    const capturedRequests: Array<[input: RequestInfo | URL, init?: RequestInit]> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      capturedRequests.push([input, init]);
      if (String(input).includes("/video/init/")) {
        return Response.json({
          data: {
            publish_id: "direct-publish-1",
            upload_url: "https://upload.example.com/direct-publish-1",
          },
        });
      }
      return new Response(null, { status: 200 });
    };

    try {
      const result = await uploadPlatformPost(basePost, videoPath, 5, fetchImpl);

      expect(capturedRequests[0]?.[0]).toBe("https://open.tiktokapis.com/v2/post/publish/video/init/");
      expect(capturedRequests[1]?.[0]).toBe("https://upload.example.com/direct-publish-1");
      expect(result).toMatchObject({
        status: "PRIVATE_ONLY_UNVERIFIED",
        externalPostId: "direct-publish-1",
        publishError: expect.stringContaining("processing"),
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("refreshes a selected TikTok credential when its expiry is unknown", async () => {
    const secret = "posting-platform-test-secret";
    vi.stubEnv("AUTH_SECRET", secret);
    vi.stubEnv("TIKTOK_POSTING_PROVIDER", "direct");
    vi.stubEnv("TIKTOK_DIRECT_POST_EXPERIMENTAL", "true");
    vi.stubEnv("TIKTOK_CLIENT_KEY", "client-key");
    vi.stubEnv("TIKTOK_CLIENT_SECRET", "client-secret");
    credentialFindFirst.mockResolvedValue({
      id: "credential-1",
      provider: "TIKTOK",
      externalAccountId: "creator-1",
      accessTokenCiphertext: encryptStoredToken("stale-token", secret),
      refreshTokenCiphertext: encryptStoredToken("refresh-token", secret),
      expiresAt: null,
    });
    credentialUpdate.mockResolvedValue(undefined);
    const tempDir = await mkdtemp(join(tmpdir(), "sermon-clip-tiktok-refresh-"));
    const videoPath = join(tempDir, "clip.mp4");
    await writeFile(videoPath, Buffer.from("video"));
    const capturedRequests: Array<[input: RequestInfo | URL, init?: RequestInit]> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      capturedRequests.push([input, init]);
      const url = String(input);
      if (url.endsWith("/oauth/token/")) {
        return Response.json({
          access_token: "fresh-token",
          refresh_token: "fresh-refresh-token",
          token_type: "Bearer",
          expires_in: 3600,
        });
      }
      if (url.includes("/video/init/")) {
        return Response.json({
          data: {
            publish_id: "refreshed-publish-1",
            upload_url: "https://upload.example.com/refreshed-publish-1",
          },
        });
      }
      return new Response(null, { status: 200 });
    };

    try {
      await uploadPlatformPost({
        ...basePost,
        socialAccountId: "selected-direct-account",
      }, videoPath, 5, fetchImpl);

      const refreshRequest = capturedRequests[0];
      expect(refreshRequest?.[0]).toBe("https://open.tiktokapis.com/v2/oauth/token/");
      expect(refreshRequest?.[1]?.body).toBeInstanceOf(URLSearchParams);
      const initRequest = capturedRequests[1];
      expect(new Headers(initRequest?.[1]?.headers).get("authorization")).toBe("Bearer fresh-token");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("treats a retryable TikTok chunk response as ambiguous", async () => {
    vi.stubEnv("TIKTOK_POSTING_PROVIDER", "direct");
    vi.stubEnv("TIKTOK_DIRECT_POST_EXPERIMENTAL", "true");
    vi.stubEnv("TIKTOK_ACCESS_TOKEN", "direct-token");
    const tempDir = await mkdtemp(join(tmpdir(), "sermon-clip-tiktok-ambiguous-"));
    const videoPath = join(tempDir, "clip.mp4");
    await writeFile(videoPath, Buffer.from("video"));
    const fetchImpl: typeof fetch = async (input) => String(input).includes("/video/init/")
      ? Response.json({
        data: {
          publish_id: "ambiguous-publish-1",
          upload_url: "https://upload.example.com/ambiguous-publish-1",
        },
      })
      : Response.json({ error: { message: "Temporarily unavailable" } }, { status: 503 });

    try {
      await expect(uploadPlatformPost(basePost, videoPath, 5, fetchImpl))
        .rejects.toBeInstanceOf(AmbiguousPlatformPublishError);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("treats a lost TikTok chunk response as ambiguous", async () => {
    vi.stubEnv("TIKTOK_POSTING_PROVIDER", "direct");
    vi.stubEnv("TIKTOK_DIRECT_POST_EXPERIMENTAL", "true");
    vi.stubEnv("TIKTOK_ACCESS_TOKEN", "direct-token");
    const tempDir = await mkdtemp(join(tmpdir(), "sermon-clip-tiktok-lost-response-"));
    const videoPath = join(tempDir, "clip.mp4");
    await writeFile(videoPath, Buffer.from("video"));
    const fetchImpl: typeof fetch = async (input) => {
      if (String(input).includes("/video/init/")) {
        return Response.json({
          data: {
            publish_id: "lost-response-publish-1",
            upload_url: "https://upload.example.com/lost-response-publish-1",
          },
        });
      }
      throw new TypeError("connection closed");
    };

    try {
      await expect(uploadPlatformPost(basePost, videoPath, 5, fetchImpl))
        .rejects.toBeInstanceOf(AmbiguousPlatformPublishError);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("posts TikTok videos through Zernio", async () => {
    vi.stubEnv("TIKTOK_POSTING_PROVIDER", "direct");
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

  it("never falls back to a legacy TikTok token for an explicitly selected account", async () => {
    vi.stubEnv("TIKTOK_POSTING_PROVIDER", "direct");
    vi.stubEnv("TIKTOK_DIRECT_POST_EXPERIMENTAL", "true");
    vi.stubEnv("TIKTOK_ACCESS_TOKEN", "unrelated-env-token");
    credentialFindFirst.mockResolvedValue(null);

    await expect(uploadPlatformPost({
      ...basePost,
      socialAccountId: "selected-direct-account",
    }, "/tmp/clip.mp4", 25)).rejects.toThrow("selected TikTok account does not have a connected credential");
  });

  it("makes an explicitly selected TikTok account provider authoritative", () => {
    expect(resolveTikTokPostingProvider({
      ...basePost,
      socialAccountId: "zernio-account",
      socialAccountExternalProvider: "zernio",
    }, "direct")).toBe("zernio");
    expect(resolveTikTokPostingProvider({
      ...basePost,
      socialAccountId: "direct-account",
      socialAccountExternalProvider: null,
    }, "zernio")).toBe("direct");
  });

  it("stages public media only for Zernio-backed video publishers", () => {
    expect(postingRequiresPublicMedia({
      ...basePost,
      socialAccountId: "direct-account",
      socialAccountExternalProvider: null,
    })).toBe(false);
    expect(postingRequiresPublicMedia({
      ...basePost,
      socialAccountId: "zernio-account",
      socialAccountExternalProvider: "zernio",
    })).toBe(true);
    expect(postingRequiresPublicMedia({ ...basePost, platform: "Instagram" })).toBe(true);
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
