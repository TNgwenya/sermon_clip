import type { MembershipRole, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export const SUPPORT_INCIDENT_CATEGORIES = [
  "ONBOARDING",
  "INTAKE",
  "PROCESSING",
  "REVIEW",
  "EDITING",
  "PUBLISHING",
  "ACCESS",
  "BILLING",
  "OTHER_OPERATIONAL",
] as const;
export const SUPPORT_INCIDENT_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export const SUPPORT_INCIDENT_STATUSES = ["OPEN", "MONITORING", "RESOLVED"] as const;
export const SUPPORT_INCIDENT_OUTCOMES = [
  "SELF_SERVE",
  "OPERATOR_ASSISTED",
  "ENGINEERING_ESCALATION",
  "NO_RESOLUTION",
  "NOT_APPLICABLE",
] as const;
export const SUPPORT_BOARD_CATEGORIES = [
  "OPERATIONAL",
  "PASTORAL_ACCURACY",
  "PRIVACY_SECURITY",
] as const;

export type SupportIncidentCategory = typeof SUPPORT_INCIDENT_CATEGORIES[number];
export type SupportIncidentSeverity = typeof SUPPORT_INCIDENT_SEVERITIES[number];
export type SupportIncidentStatus = typeof SUPPORT_INCIDENT_STATUSES[number];
export type SupportIncidentOutcome = typeof SUPPORT_INCIDENT_OUTCOMES[number];
export type SupportBoardCategory = typeof SUPPORT_BOARD_CATEGORIES[number];

export type PilotTelemetryScope = {
  organizationId: string;
  campusId: string | null;
};

export type PilotTelemetryActor = PilotTelemetryScope & {
  actorUserId: string;
  role: MembershipRole;
  permissions: {
    recordSupportEffort: boolean;
    reviewPilotTelemetry: boolean;
    exportBoardMetrics: boolean;
  };
};

export type SupportEffortInput = {
  boardCategory: SupportBoardCategory;
  category: SupportIncidentCategory;
  severity: SupportIncidentSeverity;
  status: SupportIncidentStatus;
  minutes: number;
  incidentDate: string;
  outcome: SupportIncidentOutcome;
};

export type SanitizedSupportEffortRecord = SupportEffortInput & {
  occurredAt: string;
};

type AuditDb = Pick<typeof prisma, "auditEvent">;

const SUPPORT_EFFORT_ACTION = "pilot.support_effort.recorded";
const SUPPORT_RECORD_ROLES = new Set<MembershipRole>(["OWNER", "ORG_ADMIN", "CAMPUS_ADMIN", "CONTENT_LEAD"]);
const SUPPORT_REVIEW_ROLES = new Set<MembershipRole>(["OWNER", "ORG_ADMIN", "CAMPUS_ADMIN", "ANALYST"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

export class PilotTelemetryAuthorizationError extends Error {
  constructor(message = "This role cannot access pilot support telemetry for the requested church scope.") {
    super(message);
    this.name = "PilotTelemetryAuthorizationError";
  }
}

export class InvalidSupportEffortError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSupportEffortError";
  }
}

function sameScope(actor: PilotTelemetryActor, scope: PilotTelemetryScope): boolean {
  return actor.organizationId === scope.organizationId && actor.campusId === scope.campusId;
}

function requireRecordAccess(actor: PilotTelemetryActor, scope: PilotTelemetryScope): void {
  if (
    !sameScope(actor, scope)
    || !actor.permissions.recordSupportEffort
    || !SUPPORT_RECORD_ROLES.has(actor.role)
  ) {
    throw new PilotTelemetryAuthorizationError();
  }
}

function requireReviewAccess(actor: PilotTelemetryActor, scope: PilotTelemetryScope): void {
  if (
    !sameScope(actor, scope)
    || !actor.permissions.reviewPilotTelemetry
    || !SUPPORT_REVIEW_ROLES.has(actor.role)
  ) {
    throw new PilotTelemetryAuthorizationError();
  }
}

function isEnumValue<T extends string>(allowlist: readonly T[], value: unknown): value is T {
  return typeof value === "string" && allowlist.includes(value as T);
}

export function validateSupportEffortInput(input: SupportEffortInput): SupportEffortInput {
  if (!isEnumValue(SUPPORT_BOARD_CATEGORIES, input.boardCategory)) {
    throw new InvalidSupportEffortError("Choose an allowlisted board incident category.");
  }
  if (!isEnumValue(SUPPORT_INCIDENT_CATEGORIES, input.category)) {
    throw new InvalidSupportEffortError("Choose an allowlisted incident category.");
  }
  if (!isEnumValue(SUPPORT_INCIDENT_SEVERITIES, input.severity)) {
    throw new InvalidSupportEffortError("Choose an allowlisted incident severity.");
  }
  if (!isEnumValue(SUPPORT_INCIDENT_STATUSES, input.status)) {
    throw new InvalidSupportEffortError("Choose an allowlisted incident status.");
  }
  if (!isEnumValue(SUPPORT_INCIDENT_OUTCOMES, input.outcome)) {
    throw new InvalidSupportEffortError("Choose an allowlisted incident outcome.");
  }
  if (!Number.isInteger(input.minutes) || input.minutes < 0 || input.minutes > 1_440) {
    throw new InvalidSupportEffortError("Support minutes must be a whole number from 0 to 1440.");
  }
  if (!ISO_DATE.test(input.incidentDate) || Number.isNaN(Date.parse(`${input.incidentDate}T00:00:00.000Z`))) {
    throw new InvalidSupportEffortError("Incident date must be a real ISO calendar date.");
  }
  const parsed = new Date(`${input.incidentDate}T00:00:00.000Z`);
  if (parsed.toISOString().slice(0, 10) !== input.incidentDate) {
    throw new InvalidSupportEffortError("Incident date must be a real ISO calendar date.");
  }
  return { ...input };
}

function parseStoredRecord(row: {
  metadataJson: Prisma.JsonValue | null;
  occurredAt: Date;
}): SanitizedSupportEffortRecord | null {
  if (!row.metadataJson || typeof row.metadataJson !== "object" || Array.isArray(row.metadataJson)) return null;
  const metadata = row.metadataJson as Record<string, unknown>;
  if (metadata["schemaVersion"] !== 1) return null;

  try {
    const record = validateSupportEffortInput({
      boardCategory: (metadata["boardCategory"] ?? "OPERATIONAL") as SupportBoardCategory,
      category: metadata["category"] as SupportIncidentCategory,
      severity: metadata["severity"] as SupportIncidentSeverity,
      status: metadata["status"] as SupportIncidentStatus,
      minutes: metadata["minutes"] as number,
      incidentDate: metadata["incidentDate"] as string,
      outcome: metadata["outcome"] as SupportIncidentOutcome,
    });
    return { ...record, occurredAt: row.occurredAt.toISOString() };
  } catch {
    return null;
  }
}

export class SupportEffortService {
  constructor(private readonly db: AuditDb = prisma) {}

  async record(input: {
    actor: PilotTelemetryActor;
    scope: PilotTelemetryScope;
    effort: SupportEffortInput;
    occurredAt?: Date;
  }): Promise<SanitizedSupportEffortRecord> {
    requireRecordAccess(input.actor, input.scope);
    const effort = validateSupportEffortInput(input.effort);
    const occurredAt = input.occurredAt ?? new Date();

    await this.db.auditEvent.create({
      data: {
        organizationId: input.scope.organizationId,
        campusId: input.scope.campusId,
        actorType: "USER",
        actorUserId: input.actor.actorUserId,
        action: SUPPORT_EFFORT_ACTION,
        targetType: "PilotSupportEffort",
        // No incident/customer/sermon identifier is stored in this telemetry event.
        targetId: null,
        metadataJson: {
          schemaVersion: 1,
          boardCategory: effort.boardCategory,
          category: effort.category,
          severity: effort.severity,
          status: effort.status,
          minutes: effort.minutes,
          incidentDate: effort.incidentDate,
          outcome: effort.outcome,
        },
        occurredAt,
      },
    });

    return { ...effort, occurredAt: occurredAt.toISOString() };
  }

  async list(input: {
    actor: PilotTelemetryActor;
    scope: PilotTelemetryScope;
    from: Date;
    toExclusive: Date;
  }): Promise<SanitizedSupportEffortRecord[]> {
    requireReviewAccess(input.actor, input.scope);
    if (input.from >= input.toExclusive) {
      throw new InvalidSupportEffortError("Support review range must have a start before its end.");
    }

    const rows = await this.db.auditEvent.findMany({
      where: {
        organizationId: input.scope.organizationId,
        campusId: input.scope.campusId,
        action: SUPPORT_EFFORT_ACTION,
        targetType: "PilotSupportEffort",
        occurredAt: { gte: input.from, lt: input.toExclusive },
      },
      select: { metadataJson: true, occurredAt: true },
      orderBy: { occurredAt: "asc" },
      take: 2_000,
    });

    return rows.flatMap((row) => {
      const parsed = parseStoredRecord(row);
      return parsed ? [parsed] : [];
    });
  }
}

export function canExportPilotBoardMetrics(actor: PilotTelemetryActor, scope: PilotTelemetryScope): boolean {
  return sameScope(actor, scope)
    && actor.permissions.exportBoardMetrics
    && SUPPORT_REVIEW_ROLES.has(actor.role);
}

export const __supportEffortTestUtils = {
  SUPPORT_EFFORT_ACTION,
  parseStoredRecord,
};
