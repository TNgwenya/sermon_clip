import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  canRunInlineMediaProcessing: vi.fn(),
  detect: vi.fn(),
  findUnique: vi.fn(),
  stat: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({ stat: mocks.stat }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    clipCandidate: { findUnique: mocks.findUnique },
  },
}));
vi.mock("@/server/agents/clipStudioAudioReviewService", () => ({
  detectClipStudioAudioSilenceEvents: mocks.detect,
}));
vi.mock("@/server/runtime/workerRuntime", () => ({
  canRunInlineMediaProcessing: mocks.canRunInlineMediaProcessing,
}));

import { GET } from "./route";

describe("clip audio silence review route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canRunInlineMediaProcessing.mockReturnValue(true);
    mocks.findUnique.mockResolvedValue({
      startTimeSeconds: 120,
      endTimeSeconds: 180,
      sermon: { sourceVideoPath: "/tmp/sermon.mp4" },
    });
    mocks.stat.mockResolvedValue({ isFile: () => true, size: 1_024 });
    mocks.detect.mockResolvedValue([
      { startSeconds: 4.2, endSeconds: 5.4, durationSeconds: 1.2 },
    ]);
  });

  it("runs exact audio analysis only when its deferred endpoint is requested", async () => {
    const response = await GET(
      new Request("http://localhost/api/clips/clip-1/audio-silence-review?start=120&end=180"),
      { params: Promise.resolve({ id: "clip-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      analyzed: true,
      events: [{ startSeconds: 4.2, endSeconds: 5.4, durationSeconds: 1.2 }],
    });
    expect(mocks.detect).toHaveBeenCalledWith({
      sourceVideoPath: "/tmp/sermon.mp4",
      startTimeSeconds: 120,
      endTimeSeconds: 180,
      ffmpegPath: undefined,
    });
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=300");
  });

  it("does not query media or start ffmpeg when local processing is unavailable", async () => {
    mocks.canRunInlineMediaProcessing.mockReturnValue(false);

    const response = await GET(
      new Request("http://localhost/api/clips/clip-1/audio-silence-review"),
      { params: Promise.resolve({ id: "clip-1" }) },
    );

    expect(response.status).toBe(409);
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.stat).not.toHaveBeenCalled();
    expect(mocks.detect).not.toHaveBeenCalled();
  });
});
