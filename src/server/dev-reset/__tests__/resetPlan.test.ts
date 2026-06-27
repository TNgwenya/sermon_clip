import { describe, expect, it } from "vitest";

import {
  buildDevResetPlan,
  buildMediaCleanupTargets,
  DEV_RESET_DELETE_ORDER,
  isDevelopmentResetEnvironment,
  isSafeDatabaseUrl,
} from "@/server/dev-reset/resetPlan";

describe("dev reset environment checks", () => {
  it("allows development and test environments", () => {
    expect(isDevelopmentResetEnvironment("development")).toBe(true);
    expect(isDevelopmentResetEnvironment("test")).toBe(true);
  });

  it("rejects production-like environments", () => {
    expect(isDevelopmentResetEnvironment("production")).toBe(false);
    expect(isDevelopmentResetEnvironment(undefined)).toBe(false);
  });
});

describe("dev reset database safety", () => {
  it("accepts a local sqlite database url", () => {
    expect(isSafeDatabaseUrl("file:./prisma/dev.db")).toBe(true);
  });

  it("rejects a production-like database url", () => {
    expect(isSafeDatabaseUrl("postgresql://user@prod-db.example.com:5432/sermon_clip")).toBe(false);
    expect(isSafeDatabaseUrl("file:./prisma/prod.db")).toBe(false);
  });
});

describe("dev reset plan", () => {
  it("keeps dependent records before the sermon parent in delete order", () => {
    expect(DEV_RESET_DELETE_ORDER[0]).toBe("ProcessingJob");
    expect(DEV_RESET_DELETE_ORDER).toContain("ClipCandidate");
    expect(DEV_RESET_DELETE_ORDER).toContain("ContentOpportunity");
    expect(DEV_RESET_DELETE_ORDER.at(-1)).toBe("Sermon");
  });

  it("disables media deletion by default", () => {
    const plan = buildDevResetPlan({
      storageRoot: "/workspace/storage",
      sermonIds: ["sermon-1"],
    });

    expect(plan.deleteMedia).toBe(false);
    expect(plan.mediaTargets).toHaveLength(0);
  });

  it("targets only configured sermon media directories when enabled", () => {
    const targets = buildMediaCleanupTargets({
      storageRoot: "/workspace/storage",
      sermonIds: ["sermon-1", "sermon-2"],
      deleteMedia: true,
    });

    expect(targets).toEqual([
      { sermonId: "sermon-1", path: "/workspace/storage/sermons/sermon-1" },
      { sermonId: "sermon-2", path: "/workspace/storage/sermons/sermon-2" },
    ]);
  });
});
