import { describe, expect, it } from "vitest";

import { __videoDownloadTestUtils } from "@/server/agents/videoDownloadAgent";

describe("videoDownloadAgent helpers", () => {
  it("builds best-quality yt-dlp args by default with faster fragments and direct mp4 preference", () => {
    const originalMode = process.env.SOURCE_VIDEO_DOWNLOAD_MODE;
    const originalQualityMode = process.env.SOURCE_DOWNLOAD_QUALITY_MODE;
    try {
      delete process.env.SOURCE_VIDEO_DOWNLOAD_MODE;
      delete process.env.SOURCE_DOWNLOAD_QUALITY_MODE;
      const args = __videoDownloadTestUtils.buildBaseDownloadArgs(
        "https://www.youtube.com/watch?v=abc123",
        "/tmp/source.mp4",
      );

      const format = args[args.indexOf("-f") + 1];

      expect(args).toContain("--merge-output-format");
      expect(args).toContain("mp4");
      expect(args).toContain("--newline");
      expect(args).toContain("--retries");
      expect(args).toContain("3");
      expect(args).toContain("--concurrent-fragments");
      expect(args).toContain("8");
      expect(args).toContain("--force-ipv4");
      expect(format).toBe("bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best");
    } finally {
      if (originalMode === undefined) {
        delete process.env.SOURCE_VIDEO_DOWNLOAD_MODE;
      } else {
        process.env.SOURCE_VIDEO_DOWNLOAD_MODE = originalMode;
      }
      if (originalQualityMode === undefined) {
        delete process.env.SOURCE_DOWNLOAD_QUALITY_MODE;
      } else {
        process.env.SOURCE_DOWNLOAD_QUALITY_MODE = originalQualityMode;
      }
    }
  });

  it("allows fast, balanced, and best source download modes through env", () => {
    const originalMode = process.env.SOURCE_VIDEO_DOWNLOAD_MODE;
    const originalQualityMode = process.env.SOURCE_DOWNLOAD_QUALITY_MODE;
    try {
      process.env.SOURCE_VIDEO_DOWNLOAD_MODE = "FAST";
      const fastArgs = __videoDownloadTestUtils.buildBaseDownloadArgs("https://youtu.be/abc123", "/tmp/source.mp4");
      expect(fastArgs[fastArgs.indexOf("-f") + 1]).toContain("height<=720");

      process.env.SOURCE_VIDEO_DOWNLOAD_MODE = "BALANCED";
      const balancedArgs = __videoDownloadTestUtils.buildBaseDownloadArgs("https://youtu.be/abc123", "/tmp/source.mp4");
      expect(balancedArgs[balancedArgs.indexOf("-f") + 1]).toContain("height<=1080");

      process.env.SOURCE_VIDEO_DOWNLOAD_MODE = "BEST";
      const bestArgs = __videoDownloadTestUtils.buildBaseDownloadArgs("https://youtu.be/abc123", "/tmp/source.mp4");
      expect(bestArgs[bestArgs.indexOf("-f") + 1]).toBe("bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best");

      delete process.env.SOURCE_VIDEO_DOWNLOAD_MODE;
      process.env.SOURCE_DOWNLOAD_QUALITY_MODE = "FAST";
      const aliasArgs = __videoDownloadTestUtils.buildBaseDownloadArgs("https://youtu.be/abc123", "/tmp/source.mp4");
      expect(aliasArgs[aliasArgs.indexOf("-f") + 1]).toContain("height<=720");
    } finally {
      if (originalMode === undefined) {
        delete process.env.SOURCE_VIDEO_DOWNLOAD_MODE;
      } else {
        process.env.SOURCE_VIDEO_DOWNLOAD_MODE = originalMode;
      }
      if (originalQualityMode === undefined) {
        delete process.env.SOURCE_DOWNLOAD_QUALITY_MODE;
      } else {
        process.env.SOURCE_DOWNLOAD_QUALITY_MODE = originalQualityMode;
      }
    }
  });

  it("clamps concurrent fragments to a safe range", () => {
    expect(__videoDownloadTestUtils.resolveConcurrentFragments(undefined)).toBe("8");
    expect(__videoDownloadTestUtils.resolveConcurrentFragments("0")).toBe("8");
    expect(__videoDownloadTestUtils.resolveConcurrentFragments("12")).toBe("12");
    expect(__videoDownloadTestUtils.resolveConcurrentFragments("99")).toBe("16");
  });

  it("adds an optional external downloader when configured", () => {
    const originalDownloader = process.env.YT_DLP_EXTERNAL_DOWNLOADER;
    const originalArgs = process.env.YT_DLP_EXTERNAL_DOWNLOADER_ARGS;
    try {
      process.env.YT_DLP_EXTERNAL_DOWNLOADER = "aria2c";
      process.env.YT_DLP_EXTERNAL_DOWNLOADER_ARGS = "aria2c:-x 8 -s 8 -k 1M";

      const args = __videoDownloadTestUtils.buildBaseDownloadArgs("https://youtu.be/abc123", "/tmp/source.mp4");

      expect(args).toContain("--downloader");
      expect(args).toContain("aria2c");
      expect(args).toContain("--downloader-args");
      expect(args).toContain("aria2c:-x 8 -s 8 -k 1M");
    } finally {
      if (originalDownloader === undefined) {
        delete process.env.YT_DLP_EXTERNAL_DOWNLOADER;
      } else {
        process.env.YT_DLP_EXTERNAL_DOWNLOADER = originalDownloader;
      }
      if (originalArgs === undefined) {
        delete process.env.YT_DLP_EXTERNAL_DOWNLOADER_ARGS;
      } else {
        process.env.YT_DLP_EXTERNAL_DOWNLOADER_ARGS = originalArgs;
      }
    }
  });

  it("uses the configured YouTube cookie file when present", () => {
    const originalCookieFile = process.env.YOUTUBE_COOKIE_FILE_PATH;
    try {
      process.env.YOUTUBE_COOKIE_FILE_PATH = "/private/youtube-cookies.txt";

      const args = __videoDownloadTestUtils.buildBaseDownloadArgs("https://youtu.be/abc123", "/tmp/source.mp4");

      expect(args).toContain("--cookies");
      expect(args).toContain("/private/youtube-cookies.txt");
    } finally {
      if (originalCookieFile === undefined) {
        delete process.env.YOUTUBE_COOKIE_FILE_PATH;
      } else {
        process.env.YOUTUBE_COOKIE_FILE_PATH = originalCookieFile;
      }
    }
  });

  it("uses a distinct partial path for download attempts", () => {
    const finalPath = "/tmp/sermons/source/source.mp4";
    const partialPath = __videoDownloadTestUtils.getTempDownloadPath(finalPath);

    expect(partialPath).toBe("/tmp/sermons/source/source.download.partial.mp4");
    expect(partialPath).not.toBe(finalPath);
  });

  it("detects 403-style failures", () => {
    expect(__videoDownloadTestUtils.looksLikeHttp403("HTTP Error 403: Forbidden")).toBe(true);
    expect(
      __videoDownloadTestUtils.looksLikeHttp403("ERROR: unable to download video data: HTTP Error 403"),
    ).toBe(true);
    expect(__videoDownloadTestUtils.looksLikeHttp403("network timeout")).toBe(false);
  });

  it("returns guidance-rich failure message for 403", () => {
    const message = __videoDownloadTestUtils.toDownloadFailureMessage(
      "ERROR: unable to download video data: HTTP Error 403: Forbidden",
      1,
    );

    expect(message).toContain("yt-dlp failed with code 1");
    expect(message).toContain("HTTP 403");
    expect(message).toContain("browser cookies");
  });
});
