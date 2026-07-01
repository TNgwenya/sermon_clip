import { describe, expect, it } from "vitest";

import {
  buildFramingWarnings,
  deriveBackgroundMode,
  exportStatusTone,
  isValidExportFormat,
  isValidFramingMode,
  isValidPlatformPreset,
  mapPlatformPresetToFormat,
  resolveExportHistory,
  resolveExportSettings,
  summarizeExportSettings,
  toPastorFriendlyExportStatus,
} from "@/lib/clipExportSettings";

describe("platform preset mapping", () => {
  it("maps Instagram Reels to vertical 9:16", () => {
    expect(mapPlatformPresetToFormat("INSTAGRAM_REELS")).toBe("VERTICAL_9_16");
  });

  it("maps TikTok to vertical 9:16", () => {
    expect(mapPlatformPresetToFormat("TIKTOK")).toBe("VERTICAL_9_16");
  });

  it("maps YouTube Shorts to vertical 9:16", () => {
    expect(mapPlatformPresetToFormat("YOUTUBE_SHORTS")).toBe("VERTICAL_9_16");
  });

  it("maps Facebook Reels to vertical 9:16", () => {
    expect(mapPlatformPresetToFormat("FACEBOOK_REELS")).toBe("VERTICAL_9_16");
  });

  it("maps YouTube horizontal to horizontal 16:9", () => {
    expect(mapPlatformPresetToFormat("YOUTUBE_HORIZONTAL")).toBe("HORIZONTAL_16_9");
  });

  it("maps Website horizontal to horizontal 16:9", () => {
    expect(mapPlatformPresetToFormat("WEBSITE_HORIZONTAL")).toBe("HORIZONTAL_16_9");
  });
});

describe("format validation", () => {
  it("accepts vertical 9:16", () => {
    expect(isValidExportFormat("VERTICAL_9_16")).toBe(true);
  });

  it("accepts horizontal 16:9", () => {
    expect(isValidExportFormat("HORIZONTAL_16_9")).toBe(true);
  });

  it("accepts square 1:1", () => {
    expect(isValidExportFormat("SQUARE_1_1")).toBe(true);
  });

  it("rejects unsupported format", () => {
    expect(isValidExportFormat("PANORAMA_21_9")).toBe(false);
  });
});

describe("framing validation", () => {
  it("accepts center crop", () => {
    expect(isValidFramingMode("CENTER_CROP")).toBe(true);
  });

  it("accepts left crop", () => {
    expect(isValidFramingMode("LEFT_FOCUS")).toBe(true);
  });

  it("accepts right crop", () => {
    expect(isValidFramingMode("RIGHT_FOCUS")).toBe(true);
  });

  it("accepts blurred background", () => {
    expect(isValidFramingMode("FIT_BLURRED_BACKGROUND")).toBe(true);
  });

  it("rejects unsupported framing mode", () => {
    expect(isValidFramingMode("TOP_FOCUS")).toBe(false);
  });
});

describe("platform preset validation", () => {
  it("accepts known preset", () => {
    expect(isValidPlatformPreset("INSTAGRAM_REELS")).toBe(true);
  });

  it("rejects unknown preset", () => {
    expect(isValidPlatformPreset("LINKEDIN_VERTICAL")).toBe(false);
  });
});

describe("resolveExportSettings", () => {
  it("uses safe defaults for missing settings", () => {
    const settings = resolveExportSettings({
      exportFormat: null,
      exportLayoutStrategy: null,
      captionData: null,
    });

    expect(settings.platformPreset).toBe("INSTAGRAM_REELS");
    expect(settings.primaryFormat).toBe("VERTICAL_9_16");
    expect(settings.framingMode).toBe("SMART_CROP");
    expect(settings.selectedFormats).toEqual(["VERTICAL_9_16"]);
  });

  it("loads stored export settings from captionData", () => {
    const settings = resolveExportSettings({
      exportFormat: "VERTICAL_9_16",
      exportLayoutStrategy: "CENTER_CROP",
      captionData: {
        exportSettings: {
          platformPreset: "YOUTUBE_HORIZONTAL",
          primaryFormat: "HORIZONTAL_16_9",
          selectedFormats: ["VERTICAL_9_16", "HORIZONTAL_16_9"],
          framingMode: "FIT_BLURRED_BACKGROUND",
        },
      },
    });

    expect(settings.platformPreset).toBe("YOUTUBE_HORIZONTAL");
    expect(settings.primaryFormat).toBe("HORIZONTAL_16_9");
    expect(settings.selectedFormats).toEqual(["HORIZONTAL_16_9", "VERTICAL_9_16"]);
    expect(settings.framingMode).toBe("FIT_BLURRED_BACKGROUND");
    expect(settings.backgroundMode).toBe("BLURRED");
  });

  it("falls back safely when stored values are unsupported", () => {
    const settings = resolveExportSettings({
      exportFormat: null,
      exportLayoutStrategy: null,
      captionData: {
        exportSettings: {
          platformPreset: "UNKNOWN",
          primaryFormat: "UNKNOWN",
          selectedFormats: ["UNKNOWN", "VERTICAL_9_16"],
          framingMode: "UNKNOWN",
        },
      },
    });

    expect(settings.platformPreset).toBe("INSTAGRAM_REELS");
    expect(settings.primaryFormat).toBe("VERTICAL_9_16");
    expect(settings.framingMode).toBe("SMART_CROP");
    expect(settings.selectedFormats).toEqual(["VERTICAL_9_16"]);
  });
});

describe("export history", () => {
  it("returns empty array when captionData is missing", () => {
    expect(resolveExportHistory(null)).toEqual([]);
  });

  it("parses valid export history records", () => {
    const history = resolveExportHistory({
      exportHistory: [
        {
          id: "record-1",
          clipId: "clip-1",
          sermonId: "sermon-1",
          format: "VERTICAL_9_16",
          platformPreset: "INSTAGRAM_REELS",
          framingMode: "CENTER_CROP",
          status: "COMPLETED",
          outputPath: "/tmp/clip-1-vertical.mp4",
          outputFilename: "clip-1-vertical.mp4",
          fileSizeBytes: 101,
          renderVersion: "v1",
          brandingSnapshot: {
            enabled: true,
            preset: "CLEAN_LOWER_THIRD",
            churchNameUsed: "Grace Church",
          },
          createdAt: "2026-06-18T10:00:00.000Z",
          startedAt: "2026-06-18T10:00:10.000Z",
          completedAt: "2026-06-18T10:00:20.000Z",
        },
      ],
    });

    expect(history).toHaveLength(1);
    expect(history[0]?.status).toBe("COMPLETED");
    expect(history[0]?.isLatest).toBe(true);
    expect(history[0]?.brandingSnapshot).toEqual({
      enabled: true,
      preset: "CLEAN_LOWER_THIRD",
      churchNameUsed: "Grace Church",
    });
  });

  it("ignores malformed records safely", () => {
    const history = resolveExportHistory({
      exportHistory: [
        {
          id: "bad",
          format: "UNKNOWN",
          status: "BROKEN",
        },
      ],
    });

    expect(history).toEqual([]);
  });

  it("marks latest export per format", () => {
    const history = resolveExportHistory({
      exportHistory: [
        {
          id: "record-old",
          clipId: "clip-1",
          sermonId: "sermon-1",
          format: "VERTICAL_9_16",
          platformPreset: "INSTAGRAM_REELS",
          framingMode: "CENTER_CROP",
          status: "COMPLETED",
          outputPath: "/tmp/old.mp4",
          renderVersion: "v1",
          createdAt: "2026-06-18T09:00:00.000Z",
        },
        {
          id: "record-new",
          clipId: "clip-1",
          sermonId: "sermon-1",
          format: "VERTICAL_9_16",
          platformPreset: "INSTAGRAM_REELS",
          framingMode: "CENTER_CROP",
          status: "COMPLETED",
          outputPath: "/tmp/new.mp4",
          renderVersion: "v2",
          createdAt: "2026-06-18T11:00:00.000Z",
        },
      ],
    });

    const oldRecord = history.find((item) => item.id === "record-old");
    const newRecord = history.find((item) => item.id === "record-new");

    expect(oldRecord?.isLatest).toBe(false);
    expect(newRecord?.isLatest).toBe(true);
  });
});

describe("pastor-friendly export statuses", () => {
  it("maps statuses to readable labels", () => {
    expect(toPastorFriendlyExportStatus("WAITING")).toBe("Waiting to prepare");
    expect(toPastorFriendlyExportStatus("RENDERING")).toBe("Preparing");
    expect(toPastorFriendlyExportStatus("COMPLETED")).toBe("Ready to download");
    expect(toPastorFriendlyExportStatus("FAILED")).toBe("Needs attention");
  });

  it("maps statuses to tones", () => {
    expect(exportStatusTone("WAITING")).toBe("neutral");
    expect(exportStatusTone("RENDERING")).toBe("accent");
    expect(exportStatusTone("COMPLETED")).toBe("success");
    expect(exportStatusTone("FAILED")).toBe("danger");
  });
});

describe("preview helpers", () => {
  it("builds pastor-friendly summary", () => {
    const summary = summarizeExportSettings({
      platformPreset: "INSTAGRAM_REELS",
      primaryFormat: "VERTICAL_9_16",
      selectedFormats: ["VERTICAL_9_16"],
      framingMode: "CENTER_CROP",
      framingPersonality: "AUTO_INTELLIGENT",
      backgroundMode: "CROP",
    });

    expect(summary).toContain("Ready-to-post style:");
    expect(summary).toContain("Reels");
  });

  it("separates platform and format when they do not match", () => {
    const summary = summarizeExportSettings({
      platformPreset: "INSTAGRAM_REELS",
      primaryFormat: "SQUARE_1_1",
      selectedFormats: ["SQUARE_1_1"],
      framingMode: "CENTER_CROP",
      framingPersonality: "AUTO_INTELLIGENT",
      backgroundMode: "CROP",
    });

    expect(summary).toContain("Download style:");
    expect(summary).toContain("Chosen platform: Reels");
  });

  it("shows vertical crop warnings", () => {
    const warnings = buildFramingWarnings({
      platformPreset: "INSTAGRAM_REELS",
      primaryFormat: "VERTICAL_9_16",
      selectedFormats: ["VERTICAL_9_16"],
      framingMode: "CENTER_CROP",
      framingPersonality: "AUTO_INTELLIGENT",
      backgroundMode: "CROP",
    });

    expect(warnings).toContain("Vertical crop may cut out the pastor if he moves away from the center.");
    expect(warnings).toContain("Use blurred background if the pastor moves across the stage.");
  });

  it("does not show vertical warnings for horizontal format", () => {
    const warnings = buildFramingWarnings({
      platformPreset: "YOUTUBE_HORIZONTAL",
      primaryFormat: "HORIZONTAL_16_9",
      selectedFormats: ["HORIZONTAL_16_9"],
      framingMode: "CENTER_CROP",
      framingPersonality: "AUTO_INTELLIGENT",
      backgroundMode: "CROP",
    });

    expect(warnings).toEqual([]);
  });

  it("derives background mode from framing mode", () => {
    expect(deriveBackgroundMode("FIT_BLURRED_BACKGROUND")).toBe("BLURRED");
    expect(deriveBackgroundMode("CENTER_CROP")).toBe("CROP");
  });
});
