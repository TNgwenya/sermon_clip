import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  readFile: vi.fn(),
  requireClipResource: vi.fn(),
  stat: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  readFile: mocks.readFile,
  stat: mocks.stat,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { clipCandidate: { findUnique: mocks.findUnique } },
}));
vi.mock("@/server/auth/resourceAuthorization", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/server/auth/resourceAuthorization")>(),
  requireClipResource: mocks.requireClipResource,
}));

import { GET } from "./route";

describe("smart crop debug route tenant authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not disclose snapshot existence or touch disk across tenants", async () => {
    const { AuthorizedResourceNotFoundError } = await import("@/server/auth/resourceAuthorization");
    mocks.requireClipResource.mockRejectedValue(new AuthorizedResourceNotFoundError());

    const response = await GET(
      new Request("http://localhost/api/clips/clip-other/smart-crop-debug"),
      { params: Promise.resolve({ id: "clip-other" }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Clip not found." });
    expect(mocks.requireClipResource).toHaveBeenCalledWith("content.read", "clip-other");
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.stat).not.toHaveBeenCalled();
    expect(mocks.readFile).not.toHaveBeenCalled();
  });
});
