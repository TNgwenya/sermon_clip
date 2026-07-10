import { describe, expect, it } from "vitest";

import {
  buildLocalUploadSourceUrl,
  createSermonSchema,
  isUploadedMediaFile,
} from "@/lib/sermonIntake";

function validInput(overrides: Partial<{
  youtubeUrl: string;
  title: string;
  speakerName: string;
  churchName: string;
  language: string;
  sermonStartTimestamp: string;
  sermonEndTimestamp: string;
  sermonDate: string;
  rightsConfirmed: boolean;
  hasUploadedVideo: boolean;
}> = {}) {
  return {
    youtubeUrl: "https://www.youtube.com/watch?v=abc123",
    title: "Hope in Hard Times",
    speakerName: "Pastor Jane",
    churchName: "Grace Church",
    language: "English",
    sermonStartTimestamp: "",
    sermonEndTimestamp: "",
    sermonDate: "",
    rightsConfirmed: true,
    hasUploadedVideo: false,
    ...overrides,
  };
}

describe("sermon intake", () => {
  it("accepts a sermon video link without an uploaded file", () => {
    const parsed = createSermonSchema.safeParse(validInput());

    expect(parsed.success).toBe(true);
  });

  it("accepts uploaded media without a video link", () => {
    const parsed = createSermonSchema.safeParse(validInput({
      youtubeUrl: "",
      hasUploadedVideo: true,
    }));

    expect(parsed.success).toBe(true);
  });

  it("requires either a video link or uploaded media", () => {
    const parsed = createSermonSchema.safeParse(validInput({
      youtubeUrl: "",
      hasUploadedVideo: false,
    }));

    expect(parsed.success).toBe(false);
    expect(parsed.error?.flatten().fieldErrors.youtubeUrl?.[0]).toBe(
      "Paste a sermon video link or upload a sermon media file.",
    );
  });

  it("rejects malformed video links", () => {
    const parsed = createSermonSchema.safeParse(validInput({
      youtubeUrl: "not-a-link",
    }));

    expect(parsed.success).toBe(false);
    expect(parsed.error?.flatten().fieldErrors.youtubeUrl?.[0]).toBe("Please enter a valid sermon video link.");
  });

  it("parses optional sermon segment timestamps", () => {
    const parsed = createSermonSchema.safeParse(validInput({
      sermonStartTimestamp: "32:15",
      sermonEndTimestamp: "1:18:40",
    }));

    expect(parsed.success).toBe(true);
    expect(parsed.data?.sermonStartSeconds).toBe(1935);
    expect(parsed.data?.sermonEndSeconds).toBe(4720);
  });

  it("rejects invalid sermon segment ranges", () => {
    const parsed = createSermonSchema.safeParse(validInput({
      sermonStartTimestamp: "45:00",
      sermonEndTimestamp: "20:00",
    }));

    expect(parsed.success).toBe(false);
    expect(parsed.error?.flatten().fieldErrors.sermonEndTimestamp?.[0]).toBe("Sermon end time must be after the start time.");
  });

  it("rejects malformed sermon segment timestamps", () => {
    const parsed = createSermonSchema.safeParse(validInput({
      sermonStartTimestamp: "thirty minutes",
    }));

    expect(parsed.success).toBe(false);
    expect(parsed.error?.flatten().fieldErrors.sermonStartTimestamp?.[0]).toBe("Use a format like 52:30 or 1:12:45.");
  });

  it("detects real uploaded media files and ignores empty file fields", () => {
    const mediaFile = {
      size: 128,
      arrayBuffer: async () => new ArrayBuffer(128),
      name: "IMG_0421.MOV",
      type: "",
    };
    const emptyFile = {
      size: 0,
      arrayBuffer: async () => new ArrayBuffer(0),
      name: "",
    };

    expect(isUploadedMediaFile(mediaFile as unknown as FormDataEntryValue)).toBe(true);
    expect(isUploadedMediaFile(emptyFile as unknown as FormDataEntryValue)).toBe(false);
    expect(isUploadedMediaFile("plain text field")).toBe(false);
    expect(isUploadedMediaFile(null)).toBe(false);
  });

  it("builds safe local-upload source markers for uploaded sermon files", () => {
    expect(buildLocalUploadSourceUrl("Sunday Sermon 06/19.mp4")).toBe("local-upload://Sunday%20Sermon%2006%2F19.mp4");
    expect(buildLocalUploadSourceUrl("   ")).toBe("local-upload://sermon-video");
  });
});
