import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import {
  __youtubeRecoveryUploadTestUtils,
  YouTubeRecoveryUpload,
} from "@/app/sermons/[id]/youtube-recovery-upload";

describe("YouTube owner-upload recovery", () => {
  it("renders a mobile-friendly fallback without replacing normal link import", () => {
    const markup = renderToStaticMarkup(
      <YouTubeRecoveryUpload sermonId="sermon-1" directSourceUploadEnabled />,
    );

    expect(markup).toContain("Safe YouTube fallback");
    expect(markup).toContain("The video owner must download their own video from YouTube Studio");
    expect(markup).toContain('href="https://studio.youtube.com/"');
    expect(markup).toContain("Choose video from this device");
    expect(markup).toContain("Upload original video and continue");
    expect(markup).toContain("resumes this same sermon automatically");
    expect(markup).toContain("does not compress, resize, or reduce the source quality");
    expect(markup).toContain("never ask for your YouTube password");
    expect(markup).toContain("use your cookies, browser automation, or an unofficial downloader");
    expect(markup).toContain('accept="video/*,.mp4,.mov,.m4v,.webm"');
  });

  it("builds an explicit safe-storage confirmation and phone-copy cleanup offer", () => {
    expect(__youtubeRecoveryUploadTestUtils.buildSafelyStoredMessage("Sunday.mp4")).toContain(
      "Sunday.mp4 is safely stored exactly as received",
    );
    expect(__youtubeRecoveryUploadTestUtils.buildSafelyStoredMessage("Sunday.mp4")).toContain(
      "resumed this same sermon import",
    );
    expect(__youtubeRecoveryUploadTestUtils.PHONE_COPY_DELETE_GUIDANCE).toContain(
      "delete the downloaded copy from your phone",
    );
    expect(__youtubeRecoveryUploadTestUtils.PHONE_COPY_DELETE_GUIDANCE).toContain(
      "will not delete the source safely stored in Simonclip",
    );
  });
});
