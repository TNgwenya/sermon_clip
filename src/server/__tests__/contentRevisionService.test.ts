import { describe, expect, it, vi } from "vitest";

import {
  createAssetRevision,
  createOpportunityRevision,
} from "@/server/contentRevisionService";

describe("content revision service", () => {
  it("locks the opportunity row before allocating the next immutable revision number", async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ id: "opportunity-1" }]);
    const aggregate = vi.fn().mockResolvedValue({ _max: { revisionNumber: 3 } });
    const create = vi.fn().mockResolvedValue({ id: "revision-4", revisionNumber: 4 });
    const tx = {
      $queryRaw: queryRaw,
      contentOpportunityRevision: { aggregate, create },
      contentAssetRevision: {},
    };

    const result = await createOpportunityRevision(tx as never, {
      contentOpportunityId: "opportunity-1",
      title: "Approved idea",
      content: "Approved content",
      translationReviewState: "NOT_REQUIRED",
      approvalState: "APPROVED",
    });

    expect(result).toEqual({ id: "revision-4", revisionNumber: 4 });
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(aggregate).toHaveBeenCalledAfter(queryRaw);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ revisionNumber: 4 }),
    }));
  });

  it("locks the asset row before allocating an asset revision number", async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ id: "asset-1" }]);
    const aggregate = vi.fn().mockResolvedValue({ _max: { revisionNumber: null } });
    const create = vi.fn().mockResolvedValue({ id: "revision-1", revisionNumber: 1 });
    const tx = {
      $queryRaw: queryRaw,
      contentOpportunityRevision: {},
      contentAssetRevision: { aggregate, create },
    };

    await createAssetRevision(tx as never, {
      contentAssetId: "asset-1",
      title: "Approved asset",
      approvalState: "APPROVED",
    });

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(aggregate).toHaveBeenCalledAfter(queryRaw);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ revisionNumber: 1 }),
    }));
  });
});
