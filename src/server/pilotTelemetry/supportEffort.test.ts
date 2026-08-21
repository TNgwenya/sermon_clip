import { describe, expect, it, vi } from "vitest";

import {
  __supportEffortTestUtils,
  canExportPilotBoardMetrics,
  InvalidSupportEffortError,
  PilotTelemetryAuthorizationError,
  SupportEffortService,
  type PilotTelemetryActor,
  type SupportEffortInput,
} from "@/server/pilotTelemetry/supportEffort";

const scope = { organizationId: "org-1", campusId: "campus-1" };
const admin: PilotTelemetryActor = {
  ...scope,
  actorUserId: "user-admin",
  role: "CAMPUS_ADMIN",
  permissions: {
    recordSupportEffort: true,
    reviewPilotTelemetry: true,
    exportBoardMetrics: true,
  },
};
const effort: SupportEffortInput = {
  boardCategory: "OPERATIONAL",
  category: "PROCESSING",
  severity: "MEDIUM",
  status: "RESOLVED",
  minutes: 35,
  incidentDate: "2026-08-17",
  outcome: "OPERATOR_ASSISTED",
};

describe("SupportEffortService", () => {
  it("records only allowlisted operational metadata in existing AuditEvent", async () => {
    const create = vi.fn().mockResolvedValue({ id: "audit-1" });
    const service = new SupportEffortService({ auditEvent: { create } } as never);

    await service.record({
      actor: admin,
      scope,
      effort,
      occurredAt: new Date("2026-08-17T10:00:00.000Z"),
    });

    const data = create.mock.calls[0]?.[0]?.data;
    expect(data).toEqual({
      organizationId: "org-1",
      campusId: "campus-1",
      actorType: "USER",
      actorUserId: "user-admin",
      action: __supportEffortTestUtils.SUPPORT_EFFORT_ACTION,
      targetType: "PilotSupportEffort",
      targetId: null,
      metadataJson: {
        schemaVersion: 1,
        boardCategory: "OPERATIONAL",
        category: "PROCESSING",
        severity: "MEDIUM",
        status: "RESOLVED",
        minutes: 35,
        incidentDate: "2026-08-17",
        outcome: "OPERATOR_ASSISTED",
      },
      occurredAt: new Date("2026-08-17T10:00:00.000Z"),
    });
    expect(JSON.stringify(data.metadataJson)).not.toMatch(/sermon|note|user|church|email|title|description/iu);
  });

  it("denies cross-tenant writes before touching the database", async () => {
    const create = vi.fn();
    const service = new SupportEffortService({ auditEvent: { create } } as never);

    await expect(service.record({
      actor: admin,
      scope: { organizationId: "org-other", campusId: "campus-1" },
      effort,
    })).rejects.toBeInstanceOf(PilotTelemetryAuthorizationError);
    expect(create).not.toHaveBeenCalled();
  });

  it("denies a viewer even if a caller mistakenly supplies an enabled permission", async () => {
    const create = vi.fn();
    const service = new SupportEffortService({ auditEvent: { create } } as never);

    await expect(service.record({
      actor: { ...admin, role: "VIEWER" },
      scope,
      effort,
    })).rejects.toBeInstanceOf(PilotTelemetryAuthorizationError);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects free-form or invalid incident fields", async () => {
    const service = new SupportEffortService({ auditEvent: { create: vi.fn() } } as never);
    await expect(service.record({
      actor: admin,
      scope,
      effort: { ...effort, boardCategory: "UNKNOWN" as never },
    })).rejects.toBeInstanceOf(InvalidSupportEffortError);
    await expect(service.record({
      actor: admin,
      scope,
      effort: { ...effort, category: "SERMON_TEXT: private detail" as never },
    })).rejects.toBeInstanceOf(InvalidSupportEffortError);
    await expect(service.record({
      actor: admin,
      scope,
      effort: { ...effort, minutes: 1_441 },
    })).rejects.toBeInstanceOf(InvalidSupportEffortError);
    await expect(service.record({
      actor: admin,
      scope,
      effort: { ...effort, incidentDate: "2026-02-31" },
    })).rejects.toBeInstanceOf(InvalidSupportEffortError);
  });

  it("scopes reads to the exact tenant and strips actor/event identifiers", async () => {
    const findMany = vi.fn().mockResolvedValue([{
      id: "audit-secret",
      actorUserId: "user-secret",
      occurredAt: new Date("2026-08-17T10:00:00.000Z"),
      metadataJson: { schemaVersion: 1, ...effort },
    }]);
    const service = new SupportEffortService({ auditEvent: { findMany } } as never);
    const records = await service.list({
      actor: admin,
      scope,
      from: new Date("2026-08-17T00:00:00.000Z"),
      toExclusive: new Date("2026-08-24T00:00:00.000Z"),
    });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: "org-1", campusId: "campus-1" }),
      select: { metadataJson: true, occurredAt: true },
    }));
    expect(records).toEqual([{ ...effort, occurredAt: "2026-08-17T10:00:00.000Z" }]);
    expect(JSON.stringify(records)).not.toMatch(/audit-secret|user-secret/u);
  });

  it("reads legacy records without a board category as operational", async () => {
    const legacyEffort: Partial<SupportEffortInput> = { ...effort };
    delete legacyEffort.boardCategory;
    const findMany = vi.fn().mockResolvedValue([{
      occurredAt: new Date("2026-08-17T10:00:00.000Z"),
      metadataJson: { schemaVersion: 1, ...legacyEffort },
    }]);
    const service = new SupportEffortService({ auditEvent: { findMany } } as never);
    const records = await service.list({
      actor: admin,
      scope,
      from: new Date("2026-08-17T00:00:00.000Z"),
      toExclusive: new Date("2026-08-24T00:00:00.000Z"),
    });
    expect(records[0]?.boardCategory).toBe("OPERATIONAL");
  });

  it("permits board export only for scoped review roles with explicit permission", () => {
    expect(canExportPilotBoardMetrics(admin, scope)).toBe(true);
    expect(canExportPilotBoardMetrics({ ...admin, role: "CONTENT_LEAD" }, scope)).toBe(false);
    expect(canExportPilotBoardMetrics({
      ...admin,
      permissions: { ...admin.permissions, exportBoardMetrics: false },
    }, scope)).toBe(false);
    expect(canExportPilotBoardMetrics(admin, { ...scope, campusId: "campus-2" })).toBe(false);
  });
});
