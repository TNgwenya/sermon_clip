import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { YouTubeServerRecovery } from "@/app/sermons/[id]/youtube-recovery-upload";

describe("YouTube server recovery", () => {
  it("keeps the recovery path server-side instead of asking for a device download", () => {
    const markup = renderToStaticMarkup(
      <YouTubeServerRecovery sermonId="sermon-1" jobId="job-1" />,
    );

    expect(markup).toContain("keep this import on the server");
    expect(markup).toContain("No one needs to download the video to a phone");
    expect(markup).toContain("Retry step");
    expect(markup).not.toContain("Choose video from this device");
    expect(markup).not.toContain("YouTube Studio");
  });
});
