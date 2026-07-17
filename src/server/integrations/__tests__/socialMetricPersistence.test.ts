import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
    socialMetricSnapshot: { upsert: mocks.upsert },
  },
}));

import { upsertSocialMetricSnapshots } from "@/server/integrations/socialMetricPersistence";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation((operations: Promise<unknown>[]) => Promise.all(operations));
  mocks.upsert.mockResolvedValue({});
});

describe("social metric persistence", () => {
  it("updates a repeated daily observation instead of silently discarding it", async () => {
    await upsertSocialMetricSnapshots([{
      dedupeKey: "api:tiktok:account-1:post-1:2026-07-16",
      platform: "TikTok",
      platformPostId: "post-1",
      views: 100,
      source: "API",
      capturedAt: new Date("2026-07-16T08:00:00.000Z"),
    }]);
    await upsertSocialMetricSnapshots([{
      dedupeKey: "api:tiktok:account-1:post-1:2026-07-16",
      platform: "TikTok",
      platformPostId: "post-1",
      views: 150,
      source: "API",
      capturedAt: new Date("2026-07-16T18:00:00.000Z"),
    }]);

    expect(mocks.upsert).toHaveBeenNthCalledWith(2, {
      where: { dedupeKey: "api:tiktok:account-1:post-1:2026-07-16" },
      create: expect.objectContaining({ views: 150 }),
      update: expect.objectContaining({
        views: 150,
        capturedAt: new Date("2026-07-16T18:00:00.000Z"),
      }),
    });
    expect(mocks.upsert.mock.calls[1]?.[0].update).not.toHaveProperty("id");
    expect(mocks.upsert.mock.calls[1]?.[0].update).not.toHaveProperty("createdAt");
  });

  it("does not open a transaction for an empty provider response", async () => {
    await expect(upsertSocialMetricSnapshots([])).resolves.toBe(0);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
