import type {
  WeekDraftItemFormat,
  WeekDraftProvenanceType,
} from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  assembleAutomaticWeekDraft,
  nextAutomaticWeekStart,
  selectAutomaticWeekDraftMix,
  type WeekDraftSourceCandidate,
} from "@/server/weekDraft/assembler";

function candidate(
  id: string,
  format: WeekDraftItemFormat,
  strength: number,
  options: {
    sourceType?: WeekDraftProvenanceType;
    lineageKey?: string;
  } = {},
): WeekDraftSourceCandidate {
  return {
    format,
    title: `Item ${id}`,
    payload: { copy: `Copy ${id}` },
    sourceType: options.sourceType ?? "CONTENT_OPPORTUNITY",
    sourceId: id,
    provenance: { sermonId: "sermon-1", sourceExcerpt: `Excerpt ${id}` },
    strength,
    lineageKey: options.lineageKey ?? `source:${id}`,
  };
}

describe("automatic Week Draft mix", () => {
  it("targets the next Monday after content completion", () => {
    expect(nextAutomaticWeekStart(
      new Date("2026-07-29T22:15:00.000Z"),
    )).toEqual(new Date("2026-08-03T00:00:00.000Z"));
    expect(nextAutomaticWeekStart(
      new Date("2026-08-03T08:00:00.000Z"),
    )).toEqual(new Date("2026-08-10T00:00:00.000Z"));
  });

  it("creates a six-item default mix without changing clip generation", () => {
    const selected = selectAutomaticWeekDraftMix([
      candidate("clip-1", "SHORT_FORM_VIDEO", 500, {
        sourceType: "CLIP_CANDIDATE",
      }),
      candidate("clip-2", "SHORT_FORM_VIDEO", 490, {
        sourceType: "CLIP_CANDIDATE",
      }),
      candidate("quote-1", "QUOTE_GRAPHIC", 420),
      candidate("scripture-1", "SCRIPTURE_GRAPHIC", 410),
      candidate("carousel-1", "CAROUSEL", 400),
      candidate("devotional-1", "DEVOTIONAL", 390),
      candidate("email-1", "EMAIL", 380),
      candidate("blog-1", "BLOG", 370),
    ]);

    expect(selected).toHaveLength(6);
    expect(new Set(selected.map((item) => item.format)).size).toBeGreaterThanOrEqual(3);
    expect(selected.filter((item) => item.format === "SHORT_FORM_VIDEO")).toHaveLength(2);
  });

  it("honors a configured five-to-seven total and preferred formats", () => {
    const candidates = [
      candidate("clip", "SHORT_FORM_VIDEO", 500),
      candidate("quote", "QUOTE_GRAPHIC", 420),
      candidate("scripture", "SCRIPTURE_GRAPHIC", 410),
      candidate("carousel", "CAROUSEL", 400),
      candidate("devotional", "DEVOTIONAL", 390),
      candidate("email", "EMAIL", 380),
      candidate("blog", "BLOG", 370),
    ];

    const compact = selectAutomaticWeekDraftMix(candidates, {
      targetItemCount: 5,
      preferredFormats: ["EMAIL"],
    });
    const expanded = selectAutomaticWeekDraftMix(candidates, {
      targetItemCount: 7,
    });

    expect(compact).toHaveLength(5);
    expect(compact.some((item) => item.format === "EMAIL")).toBe(true);
    expect(expanded).toHaveLength(7);
  });

  it("does not duplicate an opportunity after choosing its prepared asset", () => {
    const selected = selectAutomaticWeekDraftMix([
      candidate("asset", "QUOTE_GRAPHIC", 450, {
        sourceType: "CONTENT_ASSET",
        lineageKey: "opportunity:shared",
      }),
      candidate("opportunity", "QUOTE_GRAPHIC", 400, {
        lineageKey: "opportunity:shared",
      }),
      candidate("clip", "SHORT_FORM_VIDEO", 430),
      candidate("scripture", "SCRIPTURE_GRAPHIC", 420),
      candidate("email", "EMAIL", 410),
      candidate("blog", "BLOG", 390),
      candidate("guide", "GUIDE", 380),
    ], { targetItemCount: 5 });

    expect(selected.map((item) => item.sourceId)).toContain("asset");
    expect(selected.map((item) => item.sourceId)).not.toContain("opportunity");
  });

  it("rejects automatic totals outside the focused range", () => {
    expect(() => selectAutomaticWeekDraftMix(
      [candidate("clip", "SHORT_FORM_VIDEO", 500)],
      { targetItemCount: 8 as 7 },
    )).toThrow(/5, 6, or 7 total items/);
  });

  it("returns the existing tenant week under the advisory lock", async () => {
    const transaction = {
      sermon: {
        findFirst: vi.fn().mockResolvedValue({
          id: "sermon-1",
          title: "Grace",
          speakerName: "Pastor A",
          campusId: "campus-1",
        }),
      },
      $queryRaw: vi.fn().mockResolvedValue([{ pg_advisory_xact_lock: null }]),
      weekDraft: {
        findFirst: vi.fn().mockResolvedValue({
          id: "draft-existing",
          items: [
            { format: "SHORT_FORM_VIDEO" },
            { format: "QUOTE_GRAPHIC" },
            { format: "TEXT_POST" },
            { format: "EMAIL" },
            { format: "CAROUSEL" },
            { format: "DEVOTIONAL" },
          ],
        }),
      },
    };
    const client = {
      $transaction: vi.fn(async (
        callback: (tx: typeof transaction) => Promise<unknown>,
      ) => callback(transaction)),
    };

    const result = await assembleAutomaticWeekDraft({
      tenant: {
        organizationId: "org-1",
        campusId: "campus-1",
      },
      sermonId: "sermon-1",
      weekStartsOn: new Date("2026-08-03T12:00:00.000Z"),
      timezone: "Africa/Johannesburg",
      createdByUserId: "user-1",
    }, client as never);

    expect(result).toEqual({
      id: "draft-existing",
      created: false,
      itemCount: 6,
      formatCount: 6,
    });
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
    expect(transaction.weekDraft.findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        campusId: "campus-1",
        sermonId: "sermon-1",
        weekStartsOn: new Date("2026-08-03T00:00:00.000Z"),
      },
      select: {
        id: true,
        items: { select: { format: true } },
      },
    });
  });
});
