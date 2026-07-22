import type { ContentOpportunityType } from "@prisma/client";

export const CONTENT_OPPORTUNITY_JOB_KIND = "CONTENT_OPPORTUNITY_GENERATION" as const;
export const CONTENT_OPPORTUNITY_JOB_VERSION = 1 as const;

export type ContentOpportunityJobMode =
  | "GENERATE"
  | "REGENERATE"
  | "CONTENT_PACK"
  | "REGENERATE_TYPE";

export type ContentOpportunityJobStage = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
export type ContentOpportunityJobPhase =
  | "QUEUED"
  | "RUNNING"
  | "LOADING_CONTEXT"
  | "CHECKING_EXISTING"
  | "GENERATING"
  | "REPAIRING"
  | "PERSISTING"
  | "COMPLETED"
  | "FAILED";

export type ContentOpportunityJobRequest = {
  mode: ContentOpportunityJobMode;
  targetType?: ContentOpportunityType | null;
  quantities?: Partial<Record<ContentOpportunityType, number>>;
  replaceDefaultQuantities?: boolean;
  presetId?: string | null;
};

export type ContentOpportunityGenerationShortfallShape = {
  opportunityType: ContentOpportunityType;
  requested: number;
  fulfilled: number;
  missing: number;
  reasons: Array<{ code: string; count: number }>;
};

export type ContentOpportunityGenerationResultShape = {
  opportunityCount: number;
  archivedCount: number;
  reusedExistingOpportunities: boolean;
  complete: boolean;
  repairPasses: number;
  requestedQuantities: Partial<Record<ContentOpportunityType, number>>;
  generatedQuantities: Partial<Record<ContentOpportunityType, number>>;
  shortfalls: ContentOpportunityGenerationShortfallShape[];
};

export type ContentOpportunityJobSummary = {
  version: typeof CONTENT_OPPORTUNITY_JOB_VERSION;
  kind: typeof CONTENT_OPPORTUNITY_JOB_KIND;
  intentKey: string;
  request: {
    mode: ContentOpportunityJobMode;
    targetType: ContentOpportunityType | null;
    quantities: Partial<Record<ContentOpportunityType, number>>;
    replaceDefaultQuantities: boolean;
    presetId: string | null;
  };
  progress: {
    stage: ContentOpportunityJobStage;
    phase: ContentOpportunityJobPhase;
    percent: number;
    updatedAt: string;
  };
  result?: ContentOpportunityGenerationResultShape;
};

function safeToken(value: string | null | undefined, maxLength = 80): string | null {
  const normalized = value?.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "_").slice(0, maxLength);
  return normalized || null;
}

function normalizedCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

export function normalizeContentOpportunityJobQuantities(
  quantities?: Partial<Record<ContentOpportunityType, number>>,
): Partial<Record<ContentOpportunityType, number>> {
  return Object.fromEntries(
    Object.entries(quantities ?? {})
      .map(([type, quantity]) => [type, normalizedCount(quantity)] as const)
      .filter(([, quantity]) => quantity > 0)
      .sort(([left], [right]) => left.localeCompare(right)),
  ) as Partial<Record<ContentOpportunityType, number>>;
}

export function buildContentOpportunityJobIntentKey(request: ContentOpportunityJobRequest): string {
  const quantityKey = Object.entries(normalizeContentOpportunityJobQuantities(request.quantities))
    .map(([type, quantity]) => `${type}=${quantity}`)
    .join(",");
  return [
    `v${CONTENT_OPPORTUNITY_JOB_VERSION}`,
    request.mode,
    safeToken(request.targetType) ?? "ALL",
    request.replaceDefaultQuantities ? "REPLACE" : "MERGE",
    safeToken(request.presetId) ?? "NO_PRESET",
    quantityKey || "DEFAULT",
  ].join(":");
}

export function buildQueuedContentOpportunityJobSummary(
  request: ContentOpportunityJobRequest,
  now = new Date(),
): ContentOpportunityJobSummary {
  return {
    version: CONTENT_OPPORTUNITY_JOB_VERSION,
    kind: CONTENT_OPPORTUNITY_JOB_KIND,
    intentKey: buildContentOpportunityJobIntentKey(request),
    request: {
      mode: request.mode,
      targetType: request.targetType ?? null,
      quantities: normalizeContentOpportunityJobQuantities(request.quantities),
      replaceDefaultQuantities: request.replaceDefaultQuantities === true,
      presetId: safeToken(request.presetId),
    },
    progress: {
      stage: "QUEUED",
      phase: "QUEUED",
      percent: 0,
      updatedAt: now.toISOString(),
    },
  };
}

export function updateContentOpportunityJobProgress(
  summary: ContentOpportunityJobSummary,
  stage: ContentOpportunityJobStage,
  percent: number,
  now = new Date(),
  phase: ContentOpportunityJobPhase = stage,
): ContentOpportunityJobSummary {
  return {
    ...summary,
    progress: {
      stage,
      phase,
      percent: Math.max(0, Math.min(100, Math.floor(percent))),
      updatedAt: now.toISOString(),
    },
  };
}

export function completeContentOpportunityJobSummary(
  summary: ContentOpportunityJobSummary,
  result: ContentOpportunityGenerationResultShape,
  now = new Date(),
): ContentOpportunityJobSummary {
  return {
    ...updateContentOpportunityJobProgress(summary, "COMPLETED", 100, now, "COMPLETED"),
    result: {
      opportunityCount: normalizedCount(result.opportunityCount),
      archivedCount: normalizedCount(result.archivedCount),
      reusedExistingOpportunities: result.reusedExistingOpportunities === true,
      complete: result.complete === true,
      repairPasses: normalizedCount(result.repairPasses),
      requestedQuantities: normalizeContentOpportunityJobQuantities(result.requestedQuantities),
      generatedQuantities: normalizeContentOpportunityJobQuantities(result.generatedQuantities),
      shortfalls: result.shortfalls.map((shortfall) => ({
        opportunityType: shortfall.opportunityType,
        requested: normalizedCount(shortfall.requested),
        fulfilled: normalizedCount(shortfall.fulfilled),
        missing: normalizedCount(shortfall.missing),
        reasons: shortfall.reasons.map((reason) => ({
          code: safeToken(reason.code, 60) ?? "UNSPECIFIED",
          count: normalizedCount(reason.count),
        })),
      })),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseContentOpportunityJobSummary(value: unknown): ContentOpportunityJobSummary | null {
  if (!isRecord(value) || value.kind !== CONTENT_OPPORTUNITY_JOB_KIND || value.version !== CONTENT_OPPORTUNITY_JOB_VERSION) {
    return null;
  }
  if (!isRecord(value.request) || !isRecord(value.progress) || typeof value.intentKey !== "string") {
    return null;
  }
  const mode = value.request.mode;
  if (!(["GENERATE", "REGENERATE", "CONTENT_PACK", "REGENERATE_TYPE"] as unknown[]).includes(mode)) {
    return null;
  }
  const stage = value.progress.stage;
  if (!(["QUEUED", "RUNNING", "COMPLETED", "FAILED"] as unknown[]).includes(stage)) {
    return null;
  }

  return value as unknown as ContentOpportunityJobSummary;
}

export function contentOpportunityJobOptions(summary: ContentOpportunityJobSummary): {
  force: boolean;
  targetType?: ContentOpportunityType;
  quantities?: Partial<Record<ContentOpportunityType, number>>;
  replaceDefaultQuantities?: boolean;
} {
  const quantities = Object.keys(summary.request.quantities).length > 0
    ? summary.request.quantities
    : undefined;
  return {
    force: summary.request.mode !== "GENERATE",
    ...(summary.request.targetType ? { targetType: summary.request.targetType } : {}),
    ...(quantities ? { quantities } : {}),
    ...(summary.request.replaceDefaultQuantities ? { replaceDefaultQuantities: true } : {}),
  };
}

export function formatContentOpportunityGenerationResult(
  result: ContentOpportunityGenerationResultShape,
  targetType?: ContentOpportunityType | null,
): string {
  if (result.reusedExistingOpportunities) {
    return targetType
      ? `The existing ${targetType.replace(/_/g, " ").toLowerCase()} ideas already satisfy this request.`
      : "The existing content ideas already satisfy this request.";
  }

  const scope = targetType
    ? ` ${targetType.replace(/_/g, " ").toLowerCase()}`
    : " content";
  const archiveText = result.archivedCount > 0
    ? ` ${result.archivedCount} older draft${result.archivedCount === 1 ? " was" : "s were"} archived.`
    : "";
  const repairText = result.repairPasses > 0
    ? ` Quality repair ran ${result.repairPasses} time${result.repairPasses === 1 ? "" : "s"}.`
    : "";

  if (result.complete) {
    return `Generated ${result.opportunityCount} validated${scope} idea${result.opportunityCount === 1 ? "" : "s"}; the requested set is complete.${archiveText}${repairText}`;
  }

  const shortfallText = result.shortfalls
    .filter((item) => item.missing > 0)
    .map((item) => `${item.opportunityType.replace(/_/g, " ").toLowerCase()}: ${item.missing} missing`)
    .join("; ");
  return `Generated ${result.opportunityCount} validated${scope} idea${result.opportunityCount === 1 ? "" : "s"}, but the requested set is incomplete${shortfallText ? ` (${shortfallText})` : ""}.${archiveText}${repairText} Existing useful drafts were kept where replacements could not be validated.`;
}

export function buildContentOpportunityJobStatusView(job: {
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
  generationSummary: unknown;
}): {
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
  progressPercent: number;
  title: string;
  message: string;
} {
  const summary = parseContentOpportunityJobSummary(job.generationSummary);
  if (job.status === "PENDING") {
    return {
      status: job.status,
      progressPercent: summary?.progress.percent ?? 0,
      title: "Your request is queued",
      message: "The worker has not started this request yet. No drafts are being presented as complete.",
    };
  }
  if (job.status === "RUNNING") {
    return {
      status: job.status,
      progressPercent: summary?.progress.percent ?? 10,
      title: "Generating and validating ideas",
      message: "The worker is checking grounding, duplicates, Scripture details, and requested quantities before drafts appear.",
    };
  }
  if (job.status === "FAILED") {
    return {
      status: job.status,
      progressPercent: summary?.progress.percent ?? 0,
      title: "Content generation needs attention",
      message: "The request did not complete. Retry it from the sermon recovery tools or start a new request after checking the worker.",
    };
  }
  if (summary?.result) {
    return {
      status: job.status,
      progressPercent: 100,
      title: summary.result.complete ? "Requested idea set completed" : "Idea set completed with shortfalls",
      message: formatContentOpportunityGenerationResult(summary.result, summary.request.targetType),
    };
  }
  return {
    status: job.status,
    progressPercent: 100,
    title: "Content generation finished",
    message: "The worker finished. Review the validated drafts below.",
  };
}
