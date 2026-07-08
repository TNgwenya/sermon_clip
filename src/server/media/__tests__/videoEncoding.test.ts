import { describe, expect, it } from "vitest";

import {
  APPLE_HARDWARE_VIDEO_ENCODER,
  SOFTWARE_VIDEO_ENCODER,
  __videoEncodingTestUtils,
} from "@/server/media/videoEncoding";

const ENCODING_ENV_KEYS = [
  "CLIP_FINAL_VIDEO_ENCODER",
  "CLIP_FINAL_VIDEO_PRESET",
  "CLIP_FINAL_VIDEO_CRF",
  "CLIP_FINAL_VIDEO_BITRATE",
  "CLIP_FINAL_AUDIO_BITRATE",
  "CLIP_EXPORT_VIDEO_ENCODER",
  "CLIP_EXPORT_VIDEO_PRESET",
  "CLIP_EXPORT_VIDEO_CRF",
  "CLIP_EXPORT_VIDEO_BITRATE",
  "CLIP_EXPORT_AUDIO_BITRATE",
  "CLIP_RENDER_VIDEO_ENCODER",
  "CLIP_RENDER_VIDEO_PRESET",
  "CLIP_RENDER_VIDEO_CRF",
  "CLIP_RENDER_VIDEO_BITRATE",
  "CLIP_RENDER_AUDIO_BITRATE",
  "CLIP_AUDIO_BITRATE",
] as const;

function withCleanEncodingEnv(callback: () => void): void {
  const originalValues = new Map<string, string | undefined>();
  for (const key of ENCODING_ENV_KEYS) {
    originalValues.set(key, process.env[key]);
    delete process.env[key];
  }

  try {
    callback();
  } finally {
    for (const key of ENCODING_ENV_KEYS) {
      const value = originalValues.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe("video encoding quality profiles", () => {
  it("uses a final-quality software profile for exports by default", () => {
    withCleanEncodingEnv(() => {
      const args = __videoEncodingTestUtils.buildVideoEncoderArgs(SOFTWARE_VIDEO_ENCODER, "export");

      expect(args).toEqual([
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "18",
      ]);
    });
  });

  it("keeps working renders fast but cleaner than old preview defaults", () => {
    withCleanEncodingEnv(() => {
      const args = __videoEncodingTestUtils.buildVideoEncoderArgs(SOFTWARE_VIDEO_ENCODER, "render");

      expect(args).toContain("veryfast");
      expect(args).toContain("21");
    });
  });

  it("uses higher bitrate defaults for hardware export encoding", () => {
    withCleanEncodingEnv(() => {
      const args = __videoEncodingTestUtils.buildVideoEncoderArgs(APPLE_HARDWARE_VIDEO_ENCODER, "export");

      expect(args).toContain("h264_videotoolbox");
      expect(args).toContain("12000k");
      expect(args).toContain("-allow_sw");
    });
  });

  it("uses speech-friendly final audio bitrate by default", () => {
    withCleanEncodingEnv(() => {
      expect(__videoEncodingTestUtils.resolveAudioBitrate("export")).toBe("192k");
      expect(__videoEncodingTestUtils.resolveAudioBitrate("render")).toBe("160k");
    });
  });
});
