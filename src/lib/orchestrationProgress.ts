export type OrchestrationProgressJob = {
  lane: string;
  status: string;
  createdAt: Date;
  completedAt: Date | null;
  lastFailureCode?: string | null;
};

export type CustomerValueEvidence = {
  rankedSuggestionCount: number;
  priorityPreviewReadyCount: number;
  priorityPreviewTargetCount: number;
  firstBrandedPreviewReady: boolean;
  deferredPreviewCount: number;
};

export type CustomerValueState =
  | "waiting"
  | "active"
  | "ready"
  | "degraded"
  | "attention"
  | "not-requested";

export type CustomerValueMilestone = {
  key: "queue" | "suggestions" | "first-preview" | "top-three" | "full-content";
  label: string;
  state: CustomerValueState;
  detail: string;
};

const ACTIVE_STATUSES = new Set(["LEASED", "PENDING"]);
const FAILURE_STATUSES = new Set(["FAILED", "DEAD_LETTER"]);
const EARLY_VALUE_LANES = new Set([
  "INTAKE_MATERIALIZATION",
  "TRANSCRIPTION",
  "INTELLIGENCE",
  "PREVIEW",
]);

function latestForLane(jobs: OrchestrationProgressJob[], lane: string): OrchestrationProgressJob | null {
  return jobs
    .filter((job) => job.lane === lane)
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0] ?? null;
}

function latestLaneJobs(jobs: OrchestrationProgressJob[]): OrchestrationProgressJob[] {
  const latest = new Map<string, OrchestrationProgressJob>();
  for (const job of jobs) {
    const current = latest.get(job.lane);
    if (!current || current.createdAt.getTime() < job.createdAt.getTime()) {
      latest.set(job.lane, job);
    }
  }
  return [...latest.values()];
}

function jobState(job: OrchestrationProgressJob | null): CustomerValueState {
  if (!job) return "waiting";
  if (job.status === "SUCCEEDED") return "ready";
  if (ACTIVE_STATUSES.has(job.status)) return "active";
  if (job.status === "CANCELLED") return "not-requested";
  return "attention";
}

function failureDetail(job: OrchestrationProgressJob | null, fallback: string): string {
  if (job?.status === "DEAD_LETTER") {
    return "Repeated attempts stopped safely. Completed work is preserved for an operator to review.";
  }
  if (job?.lastFailureCode === "SAFETY_BLOCK") {
    return "Automatic preparation paused for a quality or context review. Completed work is preserved.";
  }
  return fallback;
}

function nonNegativeInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/**
 * Builds customer-facing milestones from durable jobs and durable media evidence.
 *
 * Job success alone is not enough to claim that a preview is playable. Callers
 * should provide current clip evidence so partial and stale-media states remain
 * truthful. The evidence argument is optional for health/operations callers that
 * do not have clip rows available.
 */
export function buildCustomerValueMilestones(
  jobs: OrchestrationProgressJob[],
  evidence?: CustomerValueEvidence,
): CustomerValueMilestone[] {
  const latestEarlyValueJobs = latestLaneJobs(jobs).filter((job) => EARLY_VALUE_LANES.has(job.lane));
  const intelligence = latestForLane(jobs, "INTELLIGENCE");
  const preview = latestForLane(jobs, "PREVIEW");
  const content = latestForLane(jobs, "CONTENT_WEEK");
  const suggestionCount = nonNegativeInteger(evidence?.rankedSuggestionCount ?? 0);
  const priorityTarget = nonNegativeInteger(evidence?.priorityPreviewTargetCount ?? 0);
  const priorityReady = Math.min(
    priorityTarget,
    nonNegativeInteger(evidence?.priorityPreviewReadyCount ?? 0),
  );
  const deferredPreviewCount = nonNegativeInteger(evidence?.deferredPreviewCount ?? 0);
  const suggestionsReady = suggestionCount > 0 || (!evidence && intelligence?.status === "SUCCEEDED");
  const firstBrandedReady = evidence
    ? evidence.firstBrandedPreviewReady
    : preview?.status === "SUCCEEDED";
  const hasDurableValueEvidence = Boolean(
    evidence
    && (suggestionCount > 0 || priorityReady > 0 || firstBrandedReady),
  );

  const queueState: CustomerValueState = latestEarlyValueJobs.length === 0
    ? hasDurableValueEvidence ? "ready" : "waiting"
    : latestEarlyValueJobs.some((job) => FAILURE_STATUSES.has(job.status))
      ? "attention"
      : latestEarlyValueJobs.some((job) => ACTIVE_STATUSES.has(job.status))
        ? "active"
        : latestEarlyValueJobs.every((job) => job.status === "CANCELLED")
          ? "not-requested"
          : "ready";

  const suggestionState: CustomerValueState = suggestionsReady
    ? "ready"
    : jobState(intelligence);

  const firstPreviewState: CustomerValueState = firstBrandedReady
    ? "ready"
    : jobState(preview) === "ready"
      ? "degraded"
      : jobState(preview);

  const topThreeState: CustomerValueState = priorityTarget > 0 && priorityReady >= priorityTarget
    ? "ready"
    : priorityReady > 0 && FAILURE_STATUSES.has(preview?.status ?? "")
      ? "degraded"
      : preview?.status === "SUCCEEDED" && priorityTarget > 0
        ? "degraded"
        : jobState(preview);

  const contentJobState = jobState(content);
  const contentState: CustomerValueState = !content
    ? "not-requested"
    : contentJobState === "ready" && deferredPreviewCount > 0
      ? "degraded"
      : contentJobState;

  return [
    {
      key: "queue",
      label: "Early-value work",
      state: queueState,
      detail: queueState === "waiting"
        ? "Waiting to be queued"
        : queueState === "active"
          ? "Queued or being worked on; timing depends on sermon length and current demand"
          : queueState === "attention"
            ? "One current stage needs attention; completed results remain available"
            : queueState === "not-requested"
              ? "Processing was stopped; completed results remain available"
              : firstBrandedReady
                ? "Priority preparation has finished; optional work stays separate"
                : "Saved review value is available; later preparation remains separate",
    },
    {
      key: "suggestions",
      label: "Ranked suggestions",
      state: suggestionState,
      detail: suggestionsReady
        ? `${suggestionCount || "Ranked"} ranked clip ${suggestionCount === 1 ? "suggestion is" : "suggestions are"} ready for pastor review`
        : suggestionState === "attention"
          ? failureDetail(intelligence, "Suggestions need attention before automatic review can continue")
          : suggestionState === "not-requested"
            ? "Suggestion discovery was stopped; earlier completed work is preserved"
            : "Finding faithful, self-contained moments",
    },
    {
      key: "first-preview",
      label: "First branded clip",
      state: firstPreviewState,
      detail: firstBrandedReady
        ? "The strongest suggestion has a playable, current Brand Kit preview"
        : firstPreviewState === "degraded"
          ? "Suggestions are ready, but a current branded preview could not be verified"
          : firstPreviewState === "attention"
            ? failureDetail(preview, "The branded preview needs attention; suggestions are preserved")
            : firstPreviewState === "not-requested"
              ? "Preview preparation was stopped; suggestions remain available"
              : "Preparing the strongest branded review preview first",
    },
    {
      key: "top-three",
      label: "Top review clips",
      state: topThreeState,
      detail: priorityTarget === 0
        ? "Waiting for ranked suggestions"
        : topThreeState === "ready"
          ? `${priorityReady} of ${priorityTarget} priority ${priorityTarget === 1 ? "clip is" : "clips are"} playable`
          : topThreeState === "degraded"
            ? `${priorityReady} of ${priorityTarget} priority clips are playable; the available clips can still be reviewed`
            : topThreeState === "attention"
              ? failureDetail(preview, `${priorityReady} of ${priorityTarget} priority clips are playable; remaining preview work needs attention`)
              : `${priorityReady} of ${priorityTarget} priority clips are playable; the strongest is prepared first`,
    },
    {
      key: "full-content",
      label: "Full content set",
      state: contentState,
      detail: !content
        ? `${deferredPreviewCount > 0 ? `${deferredPreviewCount} lower-ranked ${deferredPreviewCount === 1 ? "preview" : "previews"} and ` : ""}Content Week stay on demand until your team requests them`
        : contentState === "ready"
          ? "The requested Content Week and review previews are ready"
          : contentState === "degraded"
            ? `Content Week is ready; ${deferredPreviewCount} lower-ranked ${deferredPreviewCount === 1 ? "preview remains" : "previews remain"} optional and on demand`
          : contentState === "attention"
            ? failureDetail(content, "Content Week needs attention; priority clips remain available")
            : contentState === "not-requested"
              ? "The Content Week request was stopped; priority clips remain available"
              : "Building the requested Content Week in the background",
    },
  ];
}
