import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  requireSermonResource: vi.fn(),
  stat: vi.fn(),
  videoFileResponse: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({ stat: mocks.stat }));
vi.mock("@/lib/prisma", () => ({
  prisma: { sermon: { findUnique: mocks.findUnique } },
}));
vi.mock("@/server/auth/resourceAuthorization", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/server/auth/resourceAuthorization")>(),
  requireSermonResource: mocks.requireSermonResource,
}));
vi.mock("@/server/http/videoFileResponse", () => ({
  videoFileResponse: mocks.videoFileResponse,
}));
vi.mock("@/server/runtime/workerRuntime", () => ({
  canRunLocalMediaProcessing: () => true,
}));

import { GET } from "./route";

describe("sermon source preview route tenant authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not disclose or read another tenant's source media", async () => {
    const { AuthorizedResourceNotFoundError } = await import("@/server/auth/resourceAuthorization");
    mocks.requireSermonResource.mockRejectedValue(new AuthorizedResourceNotFoundError());

    const response = await GET(
      new Request("http://localhost/api/sermons/sermon-other/source-preview"),
      { params: Promise.resolve({ id: "sermon-other" }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Sermon not found." });
    expect(mocks.requireSermonResource).toHaveBeenCalledWith("sermons.read", "sermon-other");
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.stat).not.toHaveBeenCalled();
    expect(mocks.videoFileResponse).not.toHaveBeenCalled();
  });
});
