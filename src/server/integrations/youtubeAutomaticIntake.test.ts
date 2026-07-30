import { afterEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  organizationAutomationSettings: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: db }));

import {
  fetchRecentYouTubeUploads,
  parseIso8601DurationSeconds,
  runAutomaticYoutubeIntakeForOrganization,
} from "@/server/integrations/youtubeAutomaticIntake";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("YouTube automatic intake", () => {
  it("parses YouTube ISO-8601 video durations", () => {
    expect(parseIso8601DurationSeconds("PT1H2M3S")).toBe(3_723);
    expect(parseIso8601DurationSeconds("PT45M")).toBe(2_700);
    expect(parseIso8601DurationSeconds("PT0S")).toBe(0);
    expect(parseIso8601DurationSeconds("45:00")).toBeNull();
  });

  it("reads the uploads playlist and keeps public videos with valid duration", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [{
          contentDetails: { relatedPlaylists: { uploads: "UU_uploads" } },
        }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [
          {
            snippet: {
              title: "Sunday message",
              publishedAt: "2026-07-27T09:00:00.000Z",
              resourceId: { videoId: "video-public" },
            },
            contentDetails: {
              videoId: "video-public",
              videoPublishedAt: "2026-07-27T09:00:00.000Z",
            },
            status: { privacyStatus: "public" },
          },
          {
            snippet: {
              title: "Private planning stream",
              publishedAt: "2026-07-28T09:00:00.000Z",
              resourceId: { videoId: "video-private" },
            },
            contentDetails: { videoId: "video-private" },
            status: { privacyStatus: "private" },
          },
        ],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [
          {
            id: "video-public",
            contentDetails: { duration: "PT42M15S" },
            status: { privacyStatus: "public" },
          },
          {
            id: "video-private",
            contentDetails: { duration: "PT30M" },
            status: { privacyStatus: "private" },
          },
        ],
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchRecentYouTubeUploads({
      channelId: "UC_church",
      accessToken: "access-token",
    })).resolves.toEqual([{
      videoId: "video-public",
      title: "Sunday message",
      publishedAt: new Date("2026-07-27T09:00:00.000Z"),
      durationSeconds: 2_535,
      privacyStatus: "public",
    }]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("fails closed when automatic intake or rights consent is absent", async () => {
    db.organizationAutomationSettings.findUnique.mockResolvedValue({
      organizationId: "org-1",
      automaticYoutubeImportEnabled: true,
      youtubeRightsConfirmedAt: null,
    });

    await expect(runAutomaticYoutubeIntakeForOrganization(
      "org-1",
      new Date("2026-07-29T10:00:00.000Z"),
    )).resolves.toMatchObject({
      imported: 0,
      reason: "automatic-intake-disabled",
    });
  });
});
