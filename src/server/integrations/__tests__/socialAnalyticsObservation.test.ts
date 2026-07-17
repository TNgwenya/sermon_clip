import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchInstagramAccountMetrics } from "@/server/integrations/metaAnalytics";
import { fetchThreadsPostMetrics } from "@/server/integrations/threadsAnalytics";
import { fetchTikTokVideoMetrics } from "@/server/integrations/tiktokAnalytics";

const OBSERVED_AT = new Date("2026-07-16T18:30:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(OBSERVED_AT);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("post analytics observation timestamps", () => {
  it("uses TikTok sync time for the metric while preserving publication time in raw data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      data: {
        videos: [{
          id: "video-1",
          create_time: 1_735_689_600,
          view_count: 100,
          like_count: 10,
          comment_count: 2,
          share_count: 1,
        }],
      },
    })));

    const [metric] = await fetchTikTokVideoMetrics({ accessToken: "token" });

    expect(metric?.capturedAt).toEqual(OBSERVED_AT);
    expect(metric?.raw.create_time).toBe(1_735_689_600);
  });

  it("uses Threads sync time for cumulative metrics", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      data: [{
        id: "thread-1",
        timestamp: "2025-01-01T00:00:00.000Z",
        insights: { data: [{ name: "views", values: [{ value: 200 }] }] },
      }],
    })));

    const [metric] = await fetchThreadsPostMetrics({ accessToken: "token" });

    expect(metric?.capturedAt).toEqual(OBSERVED_AT);
    expect(metric?.raw.timestamp).toBe("2025-01-01T00:00:00.000Z");
  });

  it("uses Instagram sync time and records the media publication timestamp separately", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      data: [{
        id: "media-1",
        permalink: "https://instagram.example/media-1",
        timestamp: "2025-01-01T00:00:00.000Z",
        like_count: 20,
        comments_count: 4,
        insights: { data: [{ name: "reach", values: [{ value: 250 }] }] },
      }],
    })));

    const [metric] = await fetchInstagramAccountMetrics({
      instagramAccountId: "instagram-1",
      accountName: "Church Instagram",
      accessToken: "token",
      since: "2025-01-01",
      until: "2025-01-02",
    });

    expect(metric?.capturedAt).toEqual(OBSERVED_AT);
    expect(metric?.raw.publishedAt).toBe("2025-01-01T00:00:00.000Z");
  });
});
