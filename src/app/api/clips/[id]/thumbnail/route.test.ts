import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureClipThumbnail: vi.fn(),
  findFirst: vi.fn(),
  generateClipThumbnailPreview: vi.fn(),
  readFile: vi.fn(),
  requireClipResource: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({ readFile: mocks.readFile }));
vi.mock("@/lib/prisma", () => ({
  prisma: { clipCandidate: { findFirst: mocks.findFirst } },
}));
vi.mock("@/server/agents/clipThumbnailService", () => ({
  ensureClipThumbnail: mocks.ensureClipThumbnail,
  generateClipThumbnailPreview: mocks.generateClipThumbnailPreview,
}));
vi.mock("@/server/auth/resourceAuthorization", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/server/auth/resourceAuthorization")>(),
  requireClipResource: mocks.requireClipResource,
}));
vi.mock("@/server/runtime/workerRuntime", () => ({
  canRunInlineMediaProcessing: () => true,
}));

import { GET } from "./route";

describe("clip thumbnail route tenant authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not load or generate an image for a cross-tenant clip id", async () => {
    const { AuthorizedResourceNotFoundError } = await import("@/server/auth/resourceAuthorization");
    mocks.requireClipResource.mockRejectedValue(new AuthorizedResourceNotFoundError());

    const response = await GET(
      new Request("http://localhost/api/clips/clip-other/thumbnail"),
      { params: Promise.resolve({ id: "clip-other" }) },
    );

    expect(response.status).toBe(404);
    expect(mocks.requireClipResource).toHaveBeenCalledWith("content.read", "clip-other");
    expect(mocks.findFirst).not.toHaveBeenCalled();
    expect(mocks.ensureClipThumbnail).not.toHaveBeenCalled();
    expect(mocks.generateClipThumbnailPreview).not.toHaveBeenCalled();
    expect(mocks.readFile).not.toHaveBeenCalled();
  });
});
