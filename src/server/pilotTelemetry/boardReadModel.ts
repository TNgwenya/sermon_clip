import {
  buildPilotBoardExport,
  serializePilotBoardCsv,
  type PilotBoardExport,
  type PilotChurchWeekObservation,
} from "@/lib/pilotTelemetry/boardExport";
import { aggregatePilotJourneyTelemetry } from "@/lib/pilotTelemetry/journey";
import {
  buildPilotJourneyObservations,
  loadPilotTelemetryEvidence,
  type PilotTelemetryEvidence,
} from "@/server/pilotTelemetry/readModel";
import {
  SUPPORT_BOARD_CATEGORIES,
  validateSupportEffortInput,
  type SupportBoardCategory,
  type SupportEffortInput,
} from "@/server/pilotTelemetry/supportEffort";

export const PILOT_BOARD_READ_MODEL_VERSION = "pilot-board-read-model-v1";

export type PilotBoardChurchWeekObservation = PilotChurchWeekObservation & {
  fullContentMinutesTotal: number;
  fullContentTimingSampleCount: number;
};

export type PilotBoardReadModel = {
  schemaVersion: typeof PILOT_BOARD_READ_MODEL_VERSION;
  scope: "CURRENT_TENANT_WEEKLY_AGGREGATE";
  privacy: "NO_RAW_OR_PSEUDONYMOUS_IDENTIFIERS_OR_FREE_TEXT";
  generatedAt: string;
  observations: PilotBoardChurchWeekObservation[];
  boardExport: PilotBoardExport;
  csv: string;
  dataQuality: {
    ignoredSupportEvents: number;
    excludedOutOfWindowSermons: number;
    onboardingEvidenceAvailable: false;
  };
  limitations: string[];
};

type ParsedSupportEvent = {
  weekStart: string;
  minutes: number;
  critical: boolean;
  boardClass: SupportBoardCategory;
};

type VerifiedCurrentTenantScope = {
  organizationId: string;
  campusId: string | null;
  evidenceScopedToCurrentTenant: true;
};

function validDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function startOfUtcWeek(value: Date): Date {
  const date = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  const daysFromMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysFromMonday);
  return date;
}

function isoWeekStart(value: Date): string {
  return startOfUtcWeek(value).toISOString().slice(0, 10);
}

function weekStartsInWindow(from: Date, until: Date): string[] {
  const weeks: string[] = [];
  const cursor = startOfUtcWeek(from);
  while (cursor < until) {
    weeks.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return weeks;
}

function boardSupportClass(value: unknown): SupportBoardCategory | null {
  if (value === undefined) return "OPERATIONAL";
  return typeof value === "string" && SUPPORT_BOARD_CATEGORIES.includes(value as SupportBoardCategory)
    ? value as SupportBoardCategory
    : null;
}

function parseSupportEvent(row: PilotTelemetryEvidence["supportEvents"][number]): ParsedSupportEvent | null {
  if (!row.metadataJson || typeof row.metadataJson !== "object" || Array.isArray(row.metadataJson)) return null;
  const metadata = row.metadataJson as Record<string, unknown>;
  if (metadata["schemaVersion"] !== 1) return null;
  const classification = boardSupportClass(metadata["boardCategory"]);
  if (!classification) return null;
  try {
    const validated = validateSupportEffortInput({
      boardCategory: classification,
      category: metadata["category"],
      severity: metadata["severity"],
      status: metadata["status"],
      minutes: metadata["minutes"],
      incidentDate: metadata["incidentDate"],
      outcome: metadata["outcome"],
    } as SupportEffortInput);
    return {
      weekStart: isoWeekStart(new Date(`${validated.incidentDate}T00:00:00.000Z`)),
      minutes: validated.minutes,
      critical: validated.severity === "CRITICAL",
      boardClass: classification,
    };
  } catch {
    return null;
  }
}

function emptyWeek(weekStart: string): PilotBoardChurchWeekObservation {
  return {
    weekStart,
    // The current product has no durable onboarding-completion event. Unknown
    // must remain distinct from incomplete in the exported denominator.
    onboardingComplete: null,
    activeThisWeek: false,
    sermonsStarted: 0,
    suggestionsReady: 0,
    firstBrandedPreviewReady: 0,
    fullContentSetReady: 0,
    weeklyWorkflowCompleted: false,
    suggestionMinutesTotal: 0,
    suggestionTimingSampleCount: 0,
    firstPreviewMinutesTotal: 0,
    firstPreviewTimingSampleCount: 0,
    fullContentMinutesTotal: 0,
    fullContentTimingSampleCount: 0,
    supportIncidentCount: 0,
    supportMinutes: 0,
    criticalIncidentCount: 0,
    pastoralAccuracyIncidentCount: 0,
    privacySecurityIncidentCount: 0,
  };
}

function roundedMinutes(milliseconds: number): number {
  return Number((milliseconds / 60_000).toFixed(2));
}

export function buildPilotBoardReadModel(input: {
  scope: VerifiedCurrentTenantScope;
  from: Date;
  until: Date;
  generatedAt: Date;
  evidence: PilotTelemetryEvidence;
}): PilotBoardReadModel {
  if (!input.scope.evidenceScopedToCurrentTenant) {
    throw new Error("Board evidence must be loaded for the current organization and campus only.");
  }
  if (
    !input.scope.organizationId.trim()
    || !validDate(input.from)
    || !validDate(input.until)
    || !validDate(input.generatedAt)
    || input.from >= input.until
  ) {
    throw new Error("A current tenant scope and valid evidence window are required.");
  }

  const built = buildPilotJourneyObservations({
    organizationId: input.scope.organizationId,
    evidence: input.evidence,
  });
  const inWindow = built.observations.filter((observation) => (
    observation.admittedAt >= input.from && observation.admittedAt < input.until
  ));
  const journey = aggregatePilotJourneyTelemetry(inWindow, { minimumPercentileSampleSize: 2 });
  const journeyBySermon = new Map(journey.sermons.map((sermon) => [sermon.sermonKey, sermon]));
  const rows = new Map(weekStartsInWindow(input.from, input.until).map((weekStart) => [weekStart, emptyWeek(weekStart)]));

  for (const observation of inWindow) {
    const weekStart = isoWeekStart(observation.admittedAt);
    const row = rows.get(weekStart) ?? emptyWeek(weekStart);
    const sermon = journeyBySermon.get(observation.sermonKey);
    if (!sermon) continue;
    row.activeThisWeek = true;
    row.sermonsStarted += 1;
    if (sermon.suggestionsReady.state === "KNOWN" && sermon.suggestionsReady.milliseconds !== null) {
      row.suggestionsReady += 1;
      row.suggestionMinutesTotal += roundedMinutes(sermon.suggestionsReady.milliseconds);
      row.suggestionTimingSampleCount += 1;
    }
    if (sermon.firstPlayableBrandedClip.state === "KNOWN" && sermon.firstPlayableBrandedClip.milliseconds !== null) {
      row.firstBrandedPreviewReady += 1;
      row.firstPreviewMinutesTotal += roundedMinutes(sermon.firstPlayableBrandedClip.milliseconds);
      row.firstPreviewTimingSampleCount += 1;
    }
    if (sermon.fullRequestedContent.state === "KNOWN" && sermon.fullRequestedContent.milliseconds !== null) {
      row.fullContentSetReady += 1;
      row.fullContentMinutesTotal += roundedMinutes(sermon.fullRequestedContent.milliseconds);
      row.fullContentTimingSampleCount += 1;
    }
    if (
      sermon.firstPlayableBrandedClip.state === "KNOWN"
      && (observation.publishing.approvedExportCount > 0 || observation.publishing.publishedCount > 0)
    ) row.weeklyWorkflowCompleted = true;
    rows.set(weekStart, row);
  }

  let ignoredSupportEvents = 0;
  for (const event of input.evidence.supportEvents) {
    const parsed = parseSupportEvent(event);
    if (!parsed) {
      ignoredSupportEvents += 1;
      continue;
    }
    const incidentAt = new Date(`${parsed.weekStart}T00:00:00.000Z`);
    const row = rows.get(parsed.weekStart);
    if (!row || incidentAt >= input.until || new Date(incidentAt.getTime() + 7 * 24 * 60 * 60 * 1_000) <= input.from) continue;
    row.activeThisWeek = true;
    row.supportIncidentCount += 1;
    row.supportMinutes += parsed.minutes;
    row.criticalIncidentCount += parsed.critical ? 1 : 0;
    row.pastoralAccuracyIncidentCount += parsed.boardClass === "PASTORAL_ACCURACY" ? 1 : 0;
    row.privacySecurityIncidentCount += parsed.boardClass === "PRIVACY_SECURITY" ? 1 : 0;
  }

  const observations = [...rows.values()].map((row) => ({
    ...row,
    suggestionMinutesTotal: Number(row.suggestionMinutesTotal.toFixed(2)),
    firstPreviewMinutesTotal: Number(row.firstPreviewMinutesTotal.toFixed(2)),
    fullContentMinutesTotal: Number(row.fullContentMinutesTotal.toFixed(2)),
  }));
  const boardExport = buildPilotBoardExport({ observations, generatedAt: input.generatedAt });
  return {
    schemaVersion: PILOT_BOARD_READ_MODEL_VERSION,
    scope: "CURRENT_TENANT_WEEKLY_AGGREGATE",
    privacy: "NO_RAW_OR_PSEUDONYMOUS_IDENTIFIERS_OR_FREE_TEXT",
    generatedAt: input.generatedAt.toISOString(),
    observations,
    boardExport,
    csv: serializePilotBoardCsv(boardExport),
    dataQuality: {
      ignoredSupportEvents,
      excludedOutOfWindowSermons: built.observations.length - inWindow.length,
      onboardingEvidenceAvailable: false,
    },
    limitations: [
      "Onboarding completion is not durably recorded. onboardingComplete and its aggregate evidence state remain unknown, not incomplete or passing.",
      "The export contains current organization/campus evidence only. Cross-church board reporting requires privacy-safe aggregation of separate tenant exports.",
      "Pastoral-accuracy and privacy/security incidents are counted only when a valid support event carries the explicit allowlisted boardCategory; operational categories are never reclassified by inference.",
      "Full-content timing is request-to-durable-ready. PilotBoardExport schema v1 omits that timing column, so it remains available on the anonymous church-week observations only.",
      "Weekly workflow completion requires a verified branded preview plus an approved export or recorded publication; it does not infer engagement or ministry outcome.",
      "This remains directional pilot evidence, not launch-readiness proof or a production SLA.",
    ],
  };
}

export async function getPilotBoardReadModel(input: {
  organizationId: string;
  campusId: string | null;
  from: Date;
  until: Date;
  generatedAt?: Date;
}): Promise<PilotBoardReadModel> {
  const evidence = await loadPilotTelemetryEvidence({
    organizationId: input.organizationId,
    campusId: input.campusId,
    from: input.from,
    until: input.until,
  });
  return buildPilotBoardReadModel({
    scope: {
      organizationId: input.organizationId,
      campusId: input.campusId,
      evidenceScopedToCurrentTenant: true,
    },
    from: input.from,
    until: input.until,
    generatedAt: input.generatedAt ?? new Date(),
    evidence,
  });
}

export const __pilotBoardReadModelTestUtils = {
  isoWeekStart,
  parseSupportEvent,
  weekStartsInWindow,
};
