import { describe, expect, it } from "vitest";

import { __ffmpegTestUtils } from "../ffmpeg";

describe("ffmpeg media probe parsing", () => {
  it("parses finite numeric media timestamps without changing their meaning", () => {
    const result = __ffmpegTestUtils.parseMediaProbeOutput(JSON.stringify({
      streams: [
        {
          index: 0,
          codec_type: "video",
          codec_name: "h264",
          width: 1080,
          height: 1920,
          pix_fmt: "yuv420p",
          sample_aspect_ratio: "1:1",
          start_time: "0.000000",
        },
      ],
      format: {
        format_name: "mov,mp4,m4a,3gp,3g2,mj2",
        duration: "71.351000",
        start_time: "0.000000",
      },
    }));

    expect(result).toMatchObject({
      formatNames: ["mov", "mp4", "m4a", "3gp", "3g2", "mj2"],
      durationSeconds: 71.351,
      startTimeSeconds: 0,
      streams: [
        {
          startTimeSeconds: 0,
        },
      ],
    });
  });

  it("preserves null and malformed timestamps as unknown instead of coercing them to zero", () => {
    const result = __ffmpegTestUtils.parseMediaProbeOutput(JSON.stringify({
      streams: [
        {
          index: 0,
          codec_type: "video",
          codec_name: "h264",
          width: 1080,
          height: 1920,
          pix_fmt: "yuv420p",
          sample_aspect_ratio: "1:1",
          start_time: "",
        },
        {
          index: 1,
          codec_type: "audio",
          codec_name: "aac",
          start_time: "N/A",
        },
      ],
      format: {
        format_name: "mov,mp4",
        duration: null,
        start_time: false,
      },
    }));

    expect(result.durationSeconds).toBeNull();
    expect(result.startTimeSeconds).toBeNull();
    expect(result.streams.map((stream) => stream.startTimeSeconds)).toEqual([
      null,
      null,
    ]);
  });
});
