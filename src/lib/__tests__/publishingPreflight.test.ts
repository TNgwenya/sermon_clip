import { describe, expect, it } from "vitest";

import { buildPublishingPreflight, type PublishingServerCapabilities } from "@/lib/publishingPreflight";

const capabilities: PublishingServerCapabilities = {
  zernioConfigured: true,
  youtubeConfigured: false,
  youtubeOAuthClientConfigured: true,
  facebookConfigured: false,
  youtubePrivacy: "private",
  youtubeApiVerified: false,
  facebookPublishesImmediately: false,
  tiktokProviderMode: "account",
  tiktokDirectEnabled: true,
  tiktokDirectConfigured: false,
  tiktokOAuthClientConfigured: true,
  tiktokDirectPrivacy: "SELF_ONLY",
  tiktokZernioPrivacy: "PUBLIC_TO_EVERYONE",
  tiktokPrivacy: "PUBLIC_TO_EVERYONE",
};

const readyClip = {
  id: "clip-1",
  title: "Faith in the waiting",
  durationSeconds: 45,
  exportFormat: "VERTICAL_9_16",
  mediaReady: true,
  outputPath: "/tmp/clip-1.mp4",
  transcriptReviewRequired: false,
};
const liveService = { status: "ONLINE" as const, dryRun: false };

describe("publishing preflight", () => {
  it("passes a ready automatic TikTok post with an explicit Zernio connection", () => {
    const packet = buildPublishingPreflight({
      automationMode: "AUTOMATIC",
      platforms: ["TikTok"],
      clips: [readyClip],
      accounts: [{
        id: "account-1",
        platform: "TikTok",
        status: "CONNECTED",
        externalProvider: "zernio",
        externalAccountId: "zernio-1",
        externalPlatform: "tiktok",
        credentialReady: false,
      }],
      selectedAccountIdsByPlatform: { TikTok: ["account-1"] },
      capabilities,
      serviceHealth: liveService,
      checkedAt: new Date("2026-07-09T10:00:00.000Z"),
    });

    expect(packet.canSchedule).toBe(true);
    expect(packet.blockerCount).toBe(0);
    expect(packet.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "connection:TikTok", status: "PASS" }),
      expect.objectContaining({ id: "media:clip-1", status: "PASS" }),
      expect.objectContaining({ id: "format:clip-1", status: "PASS" }),
      expect.objectContaining({ id: "duration:clip-1:TikTok", status: "PASS" }),
    ]));
  });

  it("passes a connected TikTok OAuth account through the direct publisher", () => {
    const packet = buildPublishingPreflight({
      automationMode: "AUTOMATIC",
      platforms: ["TikTok"],
      clips: [readyClip],
      accounts: [{
        id: "direct-tiktok-1",
        platform: "TikTok",
        status: "CONNECTED",
        externalProvider: null,
        externalAccountId: null,
        externalPlatform: null,
        credentialReady: true,
      }],
      selectedAccountIdsByPlatform: { TikTok: ["direct-tiktok-1"] },
      capabilities: {
        ...capabilities,
        tiktokProviderMode: "direct",
      },
      serviceHealth: liveService,
    });

    expect(packet.canSchedule).toBe(true);
    expect(packet.checks).toContainEqual(expect.objectContaining({
      id: "connection:TikTok",
      status: "PASS",
      summary: expect.stringContaining("direct posting"),
    }));
    expect(packet.checks).toContainEqual(expect.objectContaining({
      id: "privacy:TikTok",
      status: "WARNING",
      summary: expect.stringContaining("SELF_ONLY"),
    }));
  });

  it("blocks mixed-quality multi-account selections instead of passing on one valid account", () => {
    const packet = buildPublishingPreflight({
      automationMode: "AUTOMATIC",
      platforms: ["TikTok"],
      clips: [readyClip],
      accounts: [
        {
          id: "direct-ready",
          platform: "TikTok",
          status: "CONNECTED",
          externalProvider: null,
          externalAccountId: null,
          externalPlatform: null,
          credentialReady: true,
        },
        {
          id: "direct-expired",
          platform: "TikTok",
          status: "CONNECTED",
          externalProvider: null,
          externalAccountId: null,
          externalPlatform: null,
          credentialReady: false,
          credentialIssue: "The second token is expired.",
        },
      ],
      selectedAccountIdsByPlatform: { TikTok: ["direct-ready", "direct-expired"] },
      capabilities: { ...capabilities, tiktokProviderMode: "direct" },
      serviceHealth: liveService,
    });

    expect(packet.canSchedule).toBe(false);
    expect(packet.checks).toContainEqual(expect.objectContaining({
      id: "connection:TikTok",
      status: "BLOCKED",
      summary: "The second token is expired.",
    }));
  });

  it("keeps experimental direct TikTok unavailable when the worker safety flag is off", () => {
    const packet = buildPublishingPreflight({
      automationMode: "AUTOMATIC",
      platforms: ["TikTok"],
      clips: [readyClip],
      accounts: [{
        id: "direct-tiktok-1",
        platform: "TikTok",
        status: "CONNECTED",
        externalProvider: null,
        externalAccountId: null,
        externalPlatform: null,
        credentialReady: true,
      }],
      selectedAccountIdsByPlatform: { TikTok: ["direct-tiktok-1"] },
      capabilities: { ...capabilities, tiktokProviderMode: "direct", tiktokDirectEnabled: false },
      serviceHealth: liveService,
    });

    expect(packet.canSchedule).toBe(false);
    expect(packet.checks).toContainEqual(expect.objectContaining({
      id: "connection:TikTok",
      status: "BLOCKED",
      summary: expect.stringContaining("disabled"),
    }));
  });

  it("blocks unavailable media, transcript review, missing connection, and unsupported Instagram duration", () => {
    const packet = buildPublishingPreflight({
      automationMode: "AUTOMATIC",
      platforms: ["Instagram"],
      clips: [{
        ...readyClip,
        durationSeconds: 61,
        mediaReady: false,
        outputPath: null,
        transcriptReviewRequired: true,
      }],
      accounts: [],
      capabilities,
      serviceHealth: liveService,
    });

    expect(packet.canSchedule).toBe(false);
    expect(packet.blockerCount).toBeGreaterThanOrEqual(4);
    expect(packet.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "connection:Instagram", status: "BLOCKED" }),
      expect.objectContaining({ id: "media:clip-1", status: "BLOCKED" }),
      expect.objectContaining({ id: "transcript:clip-1", status: "BLOCKED" }),
      expect.objectContaining({ id: "duration:clip-1:Instagram", status: "BLOCKED" }),
    ]));
  });

  it("keeps manual handoffs available while reporting non-blocking framing and privacy guidance", () => {
    const packet = buildPublishingPreflight({
      automationMode: "MANUAL",
      platforms: ["YouTube Shorts"],
      clips: [{ ...readyClip, exportFormat: "HORIZONTAL_16_9" }],
      accounts: [],
      capabilities,
      serviceHealth: { status: "NOT_SEEN", dryRun: true },
    });

    expect(packet.canSchedule).toBe(true);
    expect(packet.warningCount).toBe(1);
    expect(packet.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "publishing-service", status: "PASS" }),
      expect.objectContaining({ id: "connection:YouTube Shorts", status: "PASS" }),
      expect.objectContaining({ id: "aspect:clip-1:YouTube Shorts", status: "WARNING" }),
      expect.objectContaining({ id: "privacy:YouTube Shorts", status: "PASS" }),
    ]));
  });

  it("blocks automatic scheduling when the publishing worker is offline or in test mode", () => {
    const offline = buildPublishingPreflight({
      automationMode: "AUTOMATIC",
      platforms: ["TikTok"],
      clips: [readyClip],
      accounts: [{
        id: "account-1",
        platform: "TikTok",
        status: "CONNECTED",
        externalProvider: "zernio",
        externalAccountId: "zernio-1",
        externalPlatform: "tiktok",
        credentialReady: false,
      }],
      capabilities,
      serviceHealth: { status: "NOT_SEEN", dryRun: false },
    });
    const testMode = buildPublishingPreflight({
      automationMode: "AUTOMATIC",
      platforms: ["TikTok"],
      clips: [readyClip],
      accounts: [{
        id: "account-1",
        platform: "TikTok",
        status: "CONNECTED",
        externalProvider: "zernio",
        externalAccountId: "zernio-1",
        externalPlatform: "tiktok",
        credentialReady: false,
      }],
      capabilities,
      serviceHealth: { status: "ONLINE", dryRun: true },
    });

    expect(offline.canSchedule).toBe(false);
    expect(testMode.canSchedule).toBe(false);
    expect(testMode.checks).toContainEqual(expect.objectContaining({
      id: "publishing-service",
      status: "BLOCKED",
    }));
  });

  it("rejects a Zernio account whose external platform does not match the selected channel", () => {
    const packet = buildPublishingPreflight({
      automationMode: "AUTOMATIC",
      platforms: ["TikTok"],
      clips: [readyClip],
      accounts: [{
        id: "account-1",
        platform: "TikTok",
        status: "CONNECTED",
        externalProvider: "zernio",
        externalAccountId: "zernio-1",
        externalPlatform: "instagram",
        credentialReady: false,
      }],
      capabilities,
      serviceHealth: liveService,
    });

    expect(packet.canSchedule).toBe(false);
    expect(packet.checks).toContainEqual(expect.objectContaining({
      id: "connection:TikTok",
      status: "BLOCKED",
    }));
  });

  it("requires the worker OAuth client as well as a stored YouTube refresh credential", () => {
    const packet = buildPublishingPreflight({
      automationMode: "AUTOMATIC",
      platforms: ["YouTube Shorts"],
      clips: [readyClip],
      accounts: [{
        id: "youtube-1",
        platform: "YouTube Shorts",
        status: "CONNECTED",
        externalProvider: "youtube",
        externalAccountId: "channel-1",
        externalPlatform: "youtube",
        credentialReady: true,
      }],
      selectedAccountIdsByPlatform: { "YouTube Shorts": ["youtube-1"] },
      capabilities: {
        ...capabilities,
        youtubeOAuthClientConfigured: false,
      },
      serviceHealth: liveService,
    });

    expect(packet.canSchedule).toBe(false);
    expect(packet.checks).toContainEqual(expect.objectContaining({
      id: "connection:YouTube Shorts",
      status: "BLOCKED",
    }));
  });
});
