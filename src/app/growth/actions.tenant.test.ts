import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRequestCapability: vi.fn(),
  redirect: vi.fn((destination: string) => {
    throw new Error(`REDIRECT:${destination}`);
  }),
  revalidatePath: vi.fn(),
  growthRecommendationUpdateMany: vi.fn(),
  predictionFindFirst: vi.fn(),
  snapshotCreate: vi.fn(),
  predictionResultCreate: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/server/auth/requestAuthorization", () => ({
  requireRequestCapability: mocks.requireRequestCapability,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    growthRecommendation: {
      updateMany: mocks.growthRecommendationUpdateMany,
    },
    postPerformancePrediction: {
      findFirst: mocks.predictionFindFirst,
    },
    socialMetricSnapshot: {
      create: mocks.snapshotCreate,
    },
    postPredictionResult: {
      create: mocks.predictionResultCreate,
    },
  },
}));

import {
  recordPredictionActuals,
  updateGrowthRecommendationStatus,
} from "@/app/growth/actions";

const requestContext = {
  organizationId: "org-church-1",
  campusId: "campus-main",
  actorId: "user-editor-1",
  authenticationMethod: "session",
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRequestCapability.mockResolvedValue(requestContext);
});

describe("growth action tenant authorization", () => {
  it("scopes recommendation status updates to the trusted organization and campus", async () => {
    mocks.growthRecommendationUpdateMany.mockResolvedValue({ count: 1 });
    const formData = new FormData();
    formData.set("recommendationId", "recommendation-1");
    formData.set("status", "APPROVED");

    await expect(updateGrowthRecommendationStatus(formData))
      .rejects.toThrow("REDIRECT:/growth?recommendations=updated");

    expect(mocks.requireRequestCapability).toHaveBeenCalledWith("content.update");
    expect(mocks.growthRecommendationUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "recommendation-1",
        organizationId: requestContext.organizationId,
        campusId: requestContext.campusId,
      },
      data: { status: "APPROVED" },
    });
  });

  it("loads predictions through tenant scope and attributes manual actuals to that scope", async () => {
    mocks.predictionFindFirst.mockResolvedValue({
      id: "prediction-1",
      scheduledPostId: "post-1",
      platform: "YouTube",
      predictedReachLow: 100,
      predictedReachHigh: 200,
      predictedEngagementRate: 5,
    });
    mocks.snapshotCreate.mockResolvedValue({ id: "snapshot-1" });
    mocks.predictionResultCreate.mockResolvedValue({ id: "result-1" });
    const formData = new FormData();
    formData.set("predictionId", "prediction-1");
    formData.set("actualReach", "180");

    await expect(recordPredictionActuals(formData))
      .rejects.toThrow("REDIRECT:/growth?actuals=saved");

    expect(mocks.requireRequestCapability).toHaveBeenCalledWith("analytics.export");
    expect(mocks.predictionFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: "prediction-1",
        organizationId: requestContext.organizationId,
        campusId: requestContext.campusId,
      },
    }));
    expect(mocks.snapshotCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: requestContext.organizationId,
        campusId: requestContext.campusId,
        rawMetrics: expect.objectContaining({ predictionId: "prediction-1" }),
      }),
    }));
  });
});
