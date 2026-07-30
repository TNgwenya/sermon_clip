import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clipFindMany: vi.fn(),
  clipUpdate: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    sermon: {
      count: vi.fn(),
    },
    clipCandidate: {
      count: vi.fn(),
      findMany: mocks.clipFindMany,
      update: mocks.clipUpdate,
    },
    processingJob: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

import { repairMissingLocalAssetReferences } from "@/server/workflow/operationsDiagnostics";

describe("local asset-reference repair tenant scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.clipFindMany.mockResolvedValue([]);
  });

  it("does not scan clips outside the requested tenant", async () => {
    await repairMissingLocalAssetReferences(25, {
      organizationId: "org-a",
      campusId: "campus-a",
    });

    expect(mocks.clipFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        sermon: {
          organizationId: "org-a",
          campusId: "campus-a",
        },
      },
      take: 25,
    }));
    expect(mocks.clipUpdate).not.toHaveBeenCalled();
  });
});
