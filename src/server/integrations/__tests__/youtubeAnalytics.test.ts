import { describe, expect, it } from "vitest";

import {
  buildYouTubeAnalyticsReportUrl,
  getDefaultYouTubeAnalyticsWindow,
} from "@/server/integrations/youtubeAnalytics";

describe("youtube analytics integration", () => {
  it("builds a channel analytics report URL", () => {
    const url = new URL(buildYouTubeAnalyticsReportUrl({
      startDate: "2026-06-01",
      endDate: "2026-06-27",
      channelId: "UC123",
    }));

    expect(url.origin).toBe("https://youtubeanalytics.googleapis.com");
    expect(url.pathname).toBe("/v2/reports");
    expect(url.searchParams.get("ids")).toBe("channel==UC123");
    expect(url.searchParams.get("dimensions")).toBe("day");
    expect(url.searchParams.get("metrics")).toContain("views");
    expect(url.searchParams.get("metrics")).toContain("estimatedMinutesWatched");
    expect(url.searchParams.get("sort")).toBe("day");
  });

  it("defaults to channel MINE when no channel id is configured", () => {
    const url = new URL(buildYouTubeAnalyticsReportUrl({
      startDate: "2026-06-01",
      endDate: "2026-06-27",
    }));

    expect(url.searchParams.get("ids")).toBe("channel==MINE");
  });

  it("uses yesterday as the default end date", () => {
    expect(getDefaultYouTubeAnalyticsWindow(7, new Date("2026-06-27T12:00:00.000Z"))).toEqual({
      startDate: "2026-06-20",
      endDate: "2026-06-26",
    });
  });
});

