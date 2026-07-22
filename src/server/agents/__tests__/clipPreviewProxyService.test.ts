import { describe, expect, it } from "vitest";

import {
  COMPACT_CLIP_PREVIEW_VERSION,
  __clipPreviewProxyServiceTestUtils,
  buildCompactClipPreviewArgs,
  compactClipPreviewUrlIsCurrent,
} from "@/server/agents/clipPreviewProxyService";

function valueAfter(args: string[], option: string): string | undefined {
  const index = args.indexOf(option);
  return index >= 0 ? args[index + 1] : undefined;
}

describe("compact clip preview encoding", () => {
  it("builds a browser-friendly compact H.264 proxy without changing the source master", () => {
    const args = buildCompactClipPreviewArgs({
      sourcePath: "/media/rendered/master.mp4",
      outputPath: "/media/rendered/proxy.partial.mp4",
    });

    expect(valueAfter(args, "-i")).toBe("/media/rendered/master.mp4");
    expect(args.at(-1)).toBe("/media/rendered/proxy.partial.mp4");
    expect(valueAfter(args, "-vf")).toContain("min(540,iw)");
    expect(valueAfter(args, "-vf")).toContain("min(960,ih)");
    expect(valueAfter(args, "-vf")).toContain("fps=30");
    expect(valueAfter(args, "-vf")).toContain("format=yuv420p");
    expect(valueAfter(args, "-c:v")).toBe("libx264");
    expect(valueAfter(args, "-pix_fmt")).toBe("yuv420p");
    expect(valueAfter(args, "-maxrate")).toBe("1800k");
    expect(valueAfter(args, "-g")).toBe("60");
    expect(valueAfter(args, "-keyint_min")).toBe("60");
    expect(valueAfter(args, "-c:a")).toBe("aac");
    expect(valueAfter(args, "-b:a")).toBe("96k");
    expect(valueAfter(args, "-movflags")).toBe("+faststart");

    const generatedOutputPath = __clipPreviewProxyServiceTestUtils.buildCompactClipPreviewOutputPath(
      "/media/rendered/master.mov",
    );
    expect(generatedOutputPath).not.toBe("/media/rendered/master.mov");
    expect(generatedOutputPath).toMatch(/^\/media\/rendered\/master\.compact-v1-.+\.partial\.mp4$/);
  });

  it("recognizes only compact-v1 versioned preview URLs as optimized", () => {
    expect(compactClipPreviewUrlIsCurrent(
      `https://media.example.test/clip.mp4?v=${COMPACT_CLIP_PREVIEW_VERSION}-1780000000000`,
    )).toBe(true);
    expect(compactClipPreviewUrlIsCurrent(
      `https://media.example.test/clip.mp4?v=${COMPACT_CLIP_PREVIEW_VERSION}`,
    )).toBe(true);
    expect(compactClipPreviewUrlIsCurrent(
      "https://media.example.test/clip.mp4?v=1780000000000",
    )).toBe(false);
    expect(compactClipPreviewUrlIsCurrent(null)).toBe(false);
  });
});
