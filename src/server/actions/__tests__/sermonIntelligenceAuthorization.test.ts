import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSermonResource: vi.fn(),
  requireRequestCapability: vi.fn(),
  ministryMomentUpdateMany: vi.fn(),
  sermonIntelligenceUpdateMany: vi.fn(),
  sermonFindMany: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ministryMoment: {
      updateMany: mocks.ministryMomentUpdateMany,
    },
    sermonIntelligence: {
      updateMany: mocks.sermonIntelligenceUpdateMany,
    },
    sermon: {
      findMany: mocks.sermonFindMany,
    },
  },
}));

vi.mock("@/server/auth/resourceAuthorization", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/resourceAuthorization")>()),
  requireSermonResource: mocks.requireSermonResource,
}));

vi.mock("@/server/auth/requestAuthorization", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/requestAuthorization")>()),
  requireRequestCapability: mocks.requireRequestCapability,
}));

vi.mock("@/server/runtime/workerRuntime", () => ({
  canRunInlineMediaProcessing: vi.fn(() => false),
  localMediaProcessingUnavailableMessage: vi.fn(() => "Inline processing is unavailable."),
}));

vi.mock("@/server/agents/processing", () => ({
  queueSermonProcessingJob: vi.fn(),
}));

vi.mock("@/server/agents/clipReviewAssetService", () => ({
  prepareGeneratedClipReviewAssets: vi.fn(),
}));

import {
  saveIntelligenceOverridesAction,
  searchSermonsAction,
  updateMinistryMomentReviewStatusAction,
} from "@/server/actions/sermonIntelligence";

const authorizedSermon = {
  id: "sermon-1",
  organizationId: "org-1",
  campusId: "campus-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSermonResource.mockResolvedValue(authorizedSermon);
  mocks.requireRequestCapability.mockResolvedValue({
    actorId: "user-1",
    organizationId: "org-1",
    campusId: "campus-1",
    authenticationMethod: "session",
  });
  mocks.ministryMomentUpdateMany.mockResolvedValue({ count: 1 });
  mocks.sermonIntelligenceUpdateMany.mockResolvedValue({ count: 1 });
  mocks.sermonFindMany.mockResolvedValue([]);
});

describe("sermon intelligence action authorization", () => {
  it("authorizes the exact sermon and tenant-scopes a ministry moment write", async () => {
    await expect(updateMinistryMomentReviewStatusAction(
      "sermon-1",
      "moment-1",
      "APPROVED",
    )).resolves.toMatchObject({ success: true });

    expect(mocks.requireSermonResource).toHaveBeenCalledWith(
      "content.update",
      "sermon-1",
    );
    expect(mocks.ministryMomentUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "moment-1",
        sermonId: "sermon-1",
        sermon: {
          organizationId: "org-1",
          campusId: "campus-1",
        },
      },
      data: { reviewStatus: "APPROVED" },
    });
  });

  it("tenant-scopes the manual intelligence override write", async () => {
    const formData = new FormData();
    formData.set("manualTitle", "Reviewed title");
    formData.set("manualSummary", "Reviewed summary");
    formData.set("manualCentralTheme", "Reviewed theme");

    await expect(saveIntelligenceOverridesAction(
      "sermon-1",
      formData,
    )).resolves.toMatchObject({ success: true });

    expect(mocks.requireSermonResource).toHaveBeenCalledWith(
      "sermons.update",
      "sermon-1",
    );
    expect(mocks.sermonIntelligenceUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sermonId: "sermon-1",
          sermon: {
            organizationId: "org-1",
            campusId: "campus-1",
          },
        },
      }),
    );
  });

  it("returns the same safe denial without touching a child record", async () => {
    const {
      AuthorizedResourceNotFoundError,
    } = await import("@/server/auth/resourceAuthorization");
    mocks.requireSermonResource.mockRejectedValue(
      new AuthorizedResourceNotFoundError(),
    );

    await expect(updateMinistryMomentReviewStatusAction(
      "foreign-sermon",
      "moment-1",
      "APPROVED",
    )).resolves.toEqual({
      success: false,
      message: "This sermon is unavailable or you do not have permission to change it.",
    });
    expect(mocks.ministryMomentUpdateMany).not.toHaveBeenCalled();
  });

  it("requires read permission and tenant-scopes intelligence search", async () => {
    await searchSermonsAction({
      query: "faith",
      topic: "",
      scripture: "",
      speakerName: "",
    });

    expect(mocks.requireRequestCapability).toHaveBeenCalledWith("sermons.read");
    expect(mocks.sermonFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        AND: expect.arrayContaining([{
          organizationId: "org-1",
          campusId: "campus-1",
        }]),
      },
    }));
  });
});
