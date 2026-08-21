export const PILOT_TELEMETRY_CONTRACT_VERSION = "pilot-journey-telemetry-v1";

export type PilotOrchestrationLane =
  | "INTAKE_MATERIALIZATION"
  | "TRANSCRIPTION"
  | "INTELLIGENCE"
  | "PREVIEW"
  | "FINAL_RENDER_EXPORT"
  | "CONTENT_WEEK"
  | "PUBLISHING";

export type PilotJobStatus = "PENDING" | "LEASED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "DEAD_LETTER";

export type PilotProcessingJobEvidence = {
  jobKey: string;
  type: string;
  status: PilotJobStatus;
  createdAt: Date;
  /** ProcessingJob.startedAt. Never substitute updatedAt or completedAt. */
  startedAt: Date | null;
  completedAt: Date | null;
  attemptCount: number;
};

export type PilotOrchestrationJobEvidence = {
  jobKey: string;
  lane: PilotOrchestrationLane;
  status: PilotJobStatus;
  createdAt: Date;
  completedAt: Date | null;
  attemptCount: number;
  deadLetteredAt?: Date | null;
};

export type PilotArtifactEvidence = {
  artifactKey: string;
  kind: "RANKED_SUGGESTIONS" | "BRANDED_REVIEW_PREVIEW" | "CONTENT_WEEK_SET";
  requestedAt?: Date | null;
  readyAt?: Date | null;
  durable: boolean;
  playable?: boolean;
  brandVerified?: boolean;
  freshness?: "CURRENT" | "STALE" | "UNKNOWN";
  rank?: number | null;
};

export type PilotQualityEvidence = {
  contractPresent: boolean;
  automationMode: "FULL" | "MANUAL_REVIEW_ONLY" | "NONE";
  fallbackMode: "NONE" | "BASIC_TIME_BASED" | "MANUAL_ONLY";
  manualReviewRequired: boolean;
  manualReviewCompleted: boolean;
  safetyCorrectionCount: number;
  provenanceCheckCount: number;
  provenanceFailureCount: number;
};

export type PilotPublishingEvidence = {
  approvedExportCount: number;
  explicitPublishIntentCount: number;
  publishAttemptCount: number;
  publishedCount: number;
  blockedWithoutApprovalCount: number;
  publishedWithoutExplicitIntentCount: number;
};

export type PilotReworkEvidence = {
  explicitReplayCount: number;
  forceRegenerationCount: number;
  artifactInvalidationCount: number;
};

export type PilotJourneyObservation = {
  /** Pseudonymous stable identifiers only; do not pass titles, names, URLs, or text. */
  sermonKey: string;
  churchKey: string;
  admittedAt: Date;
  processingJobs: PilotProcessingJobEvidence[];
  orchestrationJobs: PilotOrchestrationJobEvidence[];
  artifacts: PilotArtifactEvidence[];
  quality: PilotQualityEvidence | null;
  publishing: PilotPublishingEvidence;
  rework: PilotReworkEvidence;
};

export type DataQualityFlagCode =
  | "DUPLICATE_SERMON_KEY"
  | "INVALID_TIMESTAMP"
  | "INVALID_TIMESTAMP_ORDER"
  | "INVALID_COUNT"
  | "TIMESTAMP_BEFORE_ADMISSION"
  | "MISSING_QUEUE_START"
  | "MISSING_SUGGESTION_READY_EVIDENCE"
  | "BRANDED_ARTIFACT_NOT_VERIFIED"
  | "MISSING_FULL_SET_REQUEST_EVIDENCE"
  | "MISSING_FULL_SET_READY_EVIDENCE"
  | "MISSING_QUALITY_CONTRACT"
  | "MISSING_PROVENANCE_EVIDENCE"
  | "INCONSISTENT_PROVENANCE_EVIDENCE"
  | "INCONSISTENT_PUBLISHING_EVIDENCE";

export type DataQualityFlag = {
  code: DataQualityFlagCode;
  sermonKey: string | null;
};

export type JourneyDurationEvidence = {
  state: "KNOWN" | "UNKNOWN" | "NOT_REQUESTED";
  milliseconds: number | null;
  source: "PROCESSING_JOB_STARTED" | "DURABLE_ARTIFACT" | "NONE";
};

export type SermonJourneyTelemetry = {
  sermonKey: string;
  churchKey: string;
  queueDelay: JourneyDurationEvidence;
  suggestionsReady: JourneyDurationEvidence;
  firstPlayableBrandedClip: JourneyDurationEvidence;
  fullRequestedContent: JourneyDurationEvidence;
  retryCount: number;
  deadLetterCount: number;
  fallbackUsed: boolean;
  reworkCount: number;
  safetyCorrectionCount: number;
  provenanceCheckCount: number;
  provenanceFailureCount: number;
  dataQualityFlags: DataQualityFlagCode[];
};

export type PercentileEvidence = {
  state: "KNOWN" | "INSUFFICIENT" | "UNKNOWN";
  sampleSize: number;
  minimumSampleSize: number;
  p50Milliseconds: number | null;
  p90Milliseconds: number | null;
};

export type RateEvidence = {
  state: "KNOWN" | "UNKNOWN";
  numerator: number;
  denominator: number;
  denominatorKind: "SERMONS" | "SERMONS_WITH_QUALITY_EVIDENCE" | "PROVENANCE_CHECKS" | "PUBLISH_ATTEMPTS";
  value: number | null;
};

export type StageTelemetry = {
  stage: string;
  jobCount: number;
  succeededCount: number;
  failedCount: number;
  deadLetterCount: number;
  retryCount: number;
};

export type PilotJourneyTelemetrySummary = {
  contractVersion: typeof PILOT_TELEMETRY_CONTRACT_VERSION;
  evidenceScope: "PILOT_EVIDENCE_NOT_READINESS_PROOF";
  denominators: {
    sermons: number;
    churches: number;
    sermonsWithQualityEvidence: number;
    sermonsRequestingFullContent: number;
    sermonsWithPublishAttempts: number;
  };
  durations: {
    queueDelay: PercentileEvidence;
    suggestionsReady: PercentileEvidence;
    firstPlayableBrandedClip: PercentileEvidence;
    fullRequestedContent: PercentileEvidence;
  };
  rates: {
    sermonsWithDeadLetters: RateEvidence;
    sermonsUsingFallback: RateEvidence;
    sermonsWithRework: RateEvidence;
    sermonsRequiringManualReview: RateEvidence;
    sermonsWithSafetyCorrections: RateEvidence;
    provenanceFailures: RateEvidence;
    publishAttemptsWithoutExplicitIntent: RateEvidence;
  };
  totals: {
    retries: number;
    deadLetters: number;
    fallbackSermons: number;
    reworkActions: number;
    safetyCorrections: number;
    provenanceChecks: number;
    provenanceFailures: number;
    blockedWithoutApproval: number;
    publishedWithoutExplicitIntent: number;
  };
  stages: StageTelemetry[];
  sermons: SermonJourneyTelemetry[];
  dataQualityFlags: DataQualityFlag[];
};

const FORBIDDEN_CONTENT_KEYS = /raw|payload|transcript|text|title|caption|hook|message|logs?|url|path|email|name|content/i;

function assertNoRawContent(value: unknown, path = "observation", seen = new Set<object>()): void {
  if (!value || typeof value !== "object" || value instanceof Date) return;
  if (seen.has(value)) throw new Error("Pilot telemetry input must not contain circular data.");
  seen.add(value);
  try {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_CONTENT_KEYS.test(key) && !["completedAt", "publishedCount"].includes(key)) {
        throw new Error(`Pilot telemetry rejects raw-content field at ${path}.${key}.`);
      }
      assertNoRawContent(child, `${path}.${key}`, seen);
    }
  } finally {
    seen.delete(value);
  }
}

function assertPseudonymousKey(value: string, label: string): void {
  if (!value || value.length > 128 || /\s|@|:\/\/|[\\/]/.test(value)) {
    throw new Error(`${label} must be a compact pseudonymous identifier.`);
  }
}

function isValidDate(value: Date | null | undefined): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function knownDuration(admittedAt: Date, readyAt: Date, source: JourneyDurationEvidence["source"]): JourneyDurationEvidence {
  return { state: "KNOWN", milliseconds: readyAt.getTime() - admittedAt.getTime(), source };
}

const unknownDuration = (): JourneyDurationEvidence => ({ state: "UNKNOWN", milliseconds: null, source: "NONE" });
const notRequestedDuration = (): JourneyDurationEvidence => ({ state: "NOT_REQUESTED", milliseconds: null, source: "NONE" });

function firstByDate<T>(values: T[], dateOf: (value: T) => Date | null | undefined): T | null {
  return values
    .filter((value) => isValidDate(dateOf(value)))
    .sort((left, right) => dateOf(left)!.getTime() - dateOf(right)!.getTime())[0] ?? null;
}

function nonNegativeInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function rate(
  numerator: number,
  denominator: number,
  denominatorKind: RateEvidence["denominatorKind"],
): RateEvidence {
  return denominator > 0
    ? { state: "KNOWN", numerator, denominator, denominatorKind, value: Number((numerator / denominator).toFixed(4)) }
    : { state: "UNKNOWN", numerator, denominator, denominatorKind, value: null };
}

function percentile(sorted: number[], quantile: number): number {
  const rank = Math.max(1, Math.ceil(quantile * sorted.length));
  return sorted[rank - 1];
}

function percentileEvidence(values: number[], minimumSampleSize: number): PercentileEvidence {
  if (values.length === 0) {
    return { state: "UNKNOWN", sampleSize: 0, minimumSampleSize, p50Milliseconds: null, p90Milliseconds: null };
  }
  if (values.length < minimumSampleSize) {
    return { state: "INSUFFICIENT", sampleSize: values.length, minimumSampleSize, p50Milliseconds: null, p90Milliseconds: null };
  }
  const sorted = [...values].sort((left, right) => left - right);
  return {
    state: "KNOWN",
    sampleSize: sorted.length,
    minimumSampleSize,
    p50Milliseconds: percentile(sorted, 0.5),
    p90Milliseconds: percentile(sorted, 0.9),
  };
}

function buildSermonTelemetry(observation: PilotJourneyObservation): SermonJourneyTelemetry {
  const flags = new Set<DataQualityFlagCode>();
  const admittedAt = observation.admittedAt;
  if (!isValidDate(admittedAt)) flags.add("INVALID_TIMESTAMP");
  const suppliedDates: Array<Date | null | undefined> = [
    ...observation.processingJobs.flatMap((job) => [job.createdAt, job.startedAt, job.completedAt]),
    ...observation.orchestrationJobs.flatMap((job) => [job.createdAt, job.completedAt, job.deadLetteredAt]),
    ...observation.artifacts.flatMap((artifact) => [artifact.requestedAt, artifact.readyAt]),
  ];
  if (suppliedDates.some((date) => date !== null && date !== undefined && !isValidDate(date))) {
    flags.add("INVALID_TIMESTAMP");
  }
  if (
    observation.processingJobs.some((job) => (
      (isValidDate(job.startedAt) && isValidDate(job.createdAt) && job.startedAt < job.createdAt)
      || (isValidDate(job.completedAt) && isValidDate(job.createdAt) && job.completedAt < job.createdAt)
    ))
    || observation.orchestrationJobs.some((job) => (
      isValidDate(job.completedAt) && isValidDate(job.createdAt) && job.completedAt < job.createdAt
    ))
    || observation.artifacts.some((artifact) => (
      isValidDate(artifact.readyAt) && isValidDate(artifact.requestedAt) && artifact.readyAt < artifact.requestedAt
    ))
  ) flags.add("INVALID_TIMESTAMP_ORDER");
  const suppliedCounts = [
    ...observation.orchestrationJobs.map((job) => job.attemptCount),
    ...observation.processingJobs.map((job) => job.attemptCount),
    observation.quality?.safetyCorrectionCount,
    observation.quality?.provenanceCheckCount,
    observation.quality?.provenanceFailureCount,
    ...Object.values(observation.publishing),
    ...Object.values(observation.rework),
  ].filter((value): value is number => value !== undefined);
  if (suppliedCounts.some((count) => !Number.isInteger(count) || count < 0)) flags.add("INVALID_COUNT");
  const firstProcessingJob = firstByDate(observation.processingJobs, (job) => job.createdAt);
  let queueDelay = unknownDuration();
  if (!firstProcessingJob || !isValidDate(firstProcessingJob.startedAt)) {
    flags.add("MISSING_QUEUE_START");
  } else if (!isValidDate(admittedAt) || firstProcessingJob.startedAt < firstProcessingJob.createdAt || firstProcessingJob.startedAt < admittedAt) {
    flags.add("TIMESTAMP_BEFORE_ADMISSION");
  } else {
    queueDelay = knownDuration(firstProcessingJob.createdAt, firstProcessingJob.startedAt, "PROCESSING_JOB_STARTED");
  }

  const suggestionsArtifact = firstByDate(
    observation.artifacts.filter((artifact) => artifact.kind === "RANKED_SUGGESTIONS" && artifact.durable),
    (artifact) => artifact.readyAt,
  );
  const suggestionReadyAt = suggestionsArtifact?.readyAt ?? null;
  let suggestionsReady = unknownDuration();
  if (isValidDate(admittedAt) && isValidDate(suggestionReadyAt) && suggestionReadyAt >= admittedAt) {
    suggestionsReady = knownDuration(
      admittedAt,
      suggestionReadyAt,
      "DURABLE_ARTIFACT",
    );
  } else {
    flags.add(suggestionReadyAt ? "TIMESTAMP_BEFORE_ADMISSION" : "MISSING_SUGGESTION_READY_EVIDENCE");
  }

  const brandedArtifacts = observation.artifacts.filter((artifact) => artifact.kind === "BRANDED_REVIEW_PREVIEW");
  const brandedArtifact = firstByDate(
    brandedArtifacts.filter((artifact) => (
      artifact.durable
      && artifact.playable === true
      && artifact.brandVerified === true
      && artifact.freshness === "CURRENT"
    )),
    (artifact) => artifact.readyAt,
  );
  let firstPlayableBrandedClip = unknownDuration();
  if (isValidDate(admittedAt) && isValidDate(brandedArtifact?.readyAt) && brandedArtifact.readyAt >= admittedAt) {
    firstPlayableBrandedClip = knownDuration(admittedAt, brandedArtifact.readyAt, "DURABLE_ARTIFACT");
  } else if (brandedArtifacts.length > 0) {
    flags.add("BRANDED_ARTIFACT_NOT_VERIFIED");
  }

  const contentJobs = observation.orchestrationJobs.filter((job) => job.lane === "CONTENT_WEEK");
  const contentArtifacts = observation.artifacts.filter((artifact) => artifact.kind === "CONTENT_WEEK_SET");
  const contentRequested = contentJobs.length > 0 || contentArtifacts.length > 0;
  const requestedContentArtifact = firstByDate(contentArtifacts, (artifact) => artifact.requestedAt);
  const firstContentJob = firstByDate(contentJobs, (job) => job.createdAt);
  const fullRequestedAt = requestedContentArtifact?.requestedAt ?? firstContentJob?.createdAt ?? null;
  const readyContentArtifact = firstByDate(contentArtifacts.filter((artifact) => artifact.durable), (artifact) => artifact.readyAt);
  const fullReadyAt = readyContentArtifact?.readyAt ?? null;
  let fullRequestedContent = contentRequested ? unknownDuration() : notRequestedDuration();
  if (contentRequested && isValidDate(fullRequestedAt) && isValidDate(fullReadyAt) && fullReadyAt >= fullRequestedAt) {
    fullRequestedContent = knownDuration(
      fullRequestedAt,
      fullReadyAt,
      "DURABLE_ARTIFACT",
    );
  } else if (contentRequested && !isValidDate(fullRequestedAt)) {
    flags.add("MISSING_FULL_SET_REQUEST_EVIDENCE");
  } else if (contentRequested && !isValidDate(fullReadyAt)) {
    flags.add("MISSING_FULL_SET_READY_EVIDENCE");
  } else if (contentRequested) {
    flags.add("INVALID_TIMESTAMP_ORDER");
  }

  if (!observation.quality?.contractPresent) flags.add("MISSING_QUALITY_CONTRACT");
  if (!observation.quality || observation.quality.provenanceCheckCount === 0) flags.add("MISSING_PROVENANCE_EVIDENCE");
  if (observation.quality && observation.quality.provenanceFailureCount > observation.quality.provenanceCheckCount) {
    flags.add("INCONSISTENT_PROVENANCE_EVIDENCE");
  }
  if (
    observation.publishing.publishedCount > observation.publishing.publishAttemptCount
    || observation.publishing.publishedWithoutExplicitIntentCount > observation.publishing.publishedCount
    || observation.publishing.publishedCount > observation.publishing.explicitPublishIntentCount
      + observation.publishing.publishedWithoutExplicitIntentCount
  ) flags.add("INCONSISTENT_PUBLISHING_EVIDENCE");

  return {
    sermonKey: observation.sermonKey,
    churchKey: observation.churchKey,
    queueDelay,
    suggestionsReady,
    firstPlayableBrandedClip,
    fullRequestedContent,
    retryCount: observation.orchestrationJobs.reduce((sum, job) => sum + Math.max(0, nonNegativeInteger(job.attemptCount) - 1), 0)
      + observation.processingJobs.reduce((sum, job) => sum + Math.max(0, nonNegativeInteger(job.attemptCount) - 1), 0),
    deadLetterCount: observation.orchestrationJobs.filter((job) => job.status === "DEAD_LETTER").length,
    fallbackUsed: Boolean(observation.quality && observation.quality.fallbackMode !== "NONE"),
    reworkCount: nonNegativeInteger(observation.rework.explicitReplayCount)
      + nonNegativeInteger(observation.rework.forceRegenerationCount)
      + nonNegativeInteger(observation.rework.artifactInvalidationCount),
    safetyCorrectionCount: nonNegativeInteger(observation.quality?.safetyCorrectionCount ?? 0),
    provenanceCheckCount: nonNegativeInteger(observation.quality?.provenanceCheckCount ?? 0),
    provenanceFailureCount: nonNegativeInteger(observation.quality?.provenanceFailureCount ?? 0),
    dataQualityFlags: [...flags].sort(),
  };
}

export function aggregatePilotJourneyTelemetry(
  observations: PilotJourneyObservation[],
  options: { minimumPercentileSampleSize: number },
): PilotJourneyTelemetrySummary {
  if (!Number.isInteger(options.minimumPercentileSampleSize) || options.minimumPercentileSampleSize < 2) {
    throw new Error("minimumPercentileSampleSize must be an explicit integer of at least 2.");
  }
  observations.forEach((observation) => {
    assertNoRawContent(observation);
    assertPseudonymousKey(observation.sermonKey, "sermonKey");
    assertPseudonymousKey(observation.churchKey, "churchKey");
  });
  const sermons = observations.map(buildSermonTelemetry);
  const duplicateKeys = new Set<string>();
  const seenKeys = new Set<string>();
  for (const sermon of sermons) {
    if (seenKeys.has(sermon.sermonKey)) duplicateKeys.add(sermon.sermonKey);
    seenKeys.add(sermon.sermonKey);
  }
  const qualitySermons = observations.filter((observation) => observation.quality !== null);
  const requestedFullContentCount = sermons.filter((sermon) => sermon.fullRequestedContent.state !== "NOT_REQUESTED").length;
  const publishingAttempts = observations.reduce((sum, observation) => sum + nonNegativeInteger(observation.publishing.publishAttemptCount), 0);
  const publishedWithoutIntent = observations.reduce((sum, observation) => sum + nonNegativeInteger(observation.publishing.publishedWithoutExplicitIntentCount), 0);
  const stages = new Map<string, StageTelemetry>();
  for (const observation of observations) {
    for (const job of observation.orchestrationJobs) {
      const stage = stages.get(job.lane) ?? { stage: job.lane, jobCount: 0, succeededCount: 0, failedCount: 0, deadLetterCount: 0, retryCount: 0 };
      stage.jobCount += 1;
      stage.succeededCount += job.status === "SUCCEEDED" ? 1 : 0;
      stage.failedCount += job.status === "FAILED" ? 1 : 0;
      stage.deadLetterCount += job.status === "DEAD_LETTER" ? 1 : 0;
      stage.retryCount += Math.max(0, nonNegativeInteger(job.attemptCount) - 1);
      stages.set(job.lane, stage);
    }
    for (const job of observation.processingJobs) {
      const key = `PROCESSING:${job.type}`;
      const stage = stages.get(key) ?? { stage: key, jobCount: 0, succeededCount: 0, failedCount: 0, deadLetterCount: 0, retryCount: 0 };
      stage.jobCount += 1;
      stage.succeededCount += job.status === "SUCCEEDED" ? 1 : 0;
      stage.failedCount += job.status === "FAILED" ? 1 : 0;
      stage.retryCount += Math.max(0, nonNegativeInteger(job.attemptCount) - 1);
      stages.set(key, stage);
    }
  }
  const dataQualityFlags: DataQualityFlag[] = sermons
    .flatMap((sermon) => sermon.dataQualityFlags.map((code) => ({ code, sermonKey: sermon.sermonKey })))
    .concat([...duplicateKeys].map((sermonKey) => ({ code: "DUPLICATE_SERMON_KEY" as const, sermonKey })));
  const knownValues = (selector: (sermon: SermonJourneyTelemetry) => JourneyDurationEvidence) => sermons
    .map(selector)
    .filter((evidence) => evidence.state === "KNOWN" && evidence.milliseconds !== null)
    .map((evidence) => evidence.milliseconds!);
  const totalProvenanceChecks = sermons.reduce((sum, sermon) => sum + sermon.provenanceCheckCount, 0);
  const totalProvenanceFailures = sermons.reduce((sum, sermon) => sum + sermon.provenanceFailureCount, 0);
  const fallbackSermons = sermons.filter((sermon) => sermon.fallbackUsed).length;
  const reworkSermons = sermons.filter((sermon) => sermon.reworkCount > 0).length;
  const manualReviewSermons = qualitySermons.filter((observation) => observation.quality!.manualReviewRequired).length;
  return {
    contractVersion: PILOT_TELEMETRY_CONTRACT_VERSION,
    evidenceScope: "PILOT_EVIDENCE_NOT_READINESS_PROOF",
    denominators: {
      sermons: sermons.length,
      churches: new Set(sermons.map((sermon) => sermon.churchKey)).size,
      sermonsWithQualityEvidence: qualitySermons.length,
      sermonsRequestingFullContent: requestedFullContentCount,
      sermonsWithPublishAttempts: observations.filter((observation) => observation.publishing.publishAttemptCount > 0).length,
    },
    durations: {
      queueDelay: percentileEvidence(knownValues((sermon) => sermon.queueDelay), options.minimumPercentileSampleSize),
      suggestionsReady: percentileEvidence(knownValues((sermon) => sermon.suggestionsReady), options.minimumPercentileSampleSize),
      firstPlayableBrandedClip: percentileEvidence(knownValues((sermon) => sermon.firstPlayableBrandedClip), options.minimumPercentileSampleSize),
      fullRequestedContent: percentileEvidence(knownValues((sermon) => sermon.fullRequestedContent), options.minimumPercentileSampleSize),
    },
    rates: {
      sermonsWithDeadLetters: rate(sermons.filter((sermon) => sermon.deadLetterCount > 0).length, sermons.length, "SERMONS"),
      sermonsUsingFallback: rate(fallbackSermons, sermons.length, "SERMONS"),
      sermonsWithRework: rate(reworkSermons, sermons.length, "SERMONS"),
      sermonsRequiringManualReview: rate(manualReviewSermons, qualitySermons.length, "SERMONS_WITH_QUALITY_EVIDENCE"),
      sermonsWithSafetyCorrections: rate(
        sermons.filter((sermon) => sermon.safetyCorrectionCount > 0).length,
        qualitySermons.length,
        "SERMONS_WITH_QUALITY_EVIDENCE",
      ),
      provenanceFailures: rate(totalProvenanceFailures, totalProvenanceChecks, "PROVENANCE_CHECKS"),
      // One governed intent can legitimately be retried under the same
      // connector idempotency key. Intent-count minus attempt-count would
      // therefore manufacture violations. Count only the explicit violation
      // evidence supplied by the publishing reconciliation boundary.
      publishAttemptsWithoutExplicitIntent: rate(publishedWithoutIntent, publishingAttempts, "PUBLISH_ATTEMPTS"),
    },
    totals: {
      retries: sermons.reduce((sum, sermon) => sum + sermon.retryCount, 0),
      deadLetters: sermons.reduce((sum, sermon) => sum + sermon.deadLetterCount, 0),
      fallbackSermons,
      reworkActions: sermons.reduce((sum, sermon) => sum + sermon.reworkCount, 0),
      safetyCorrections: sermons.reduce((sum, sermon) => sum + sermon.safetyCorrectionCount, 0),
      provenanceChecks: totalProvenanceChecks,
      provenanceFailures: totalProvenanceFailures,
      blockedWithoutApproval: observations.reduce((sum, observation) => sum + nonNegativeInteger(observation.publishing.blockedWithoutApprovalCount), 0),
      publishedWithoutExplicitIntent: publishedWithoutIntent,
    },
    stages: [...stages.values()].sort((left, right) => left.stage.localeCompare(right.stage)),
    sermons,
    dataQualityFlags,
  };
}

export type PilotStopThresholds = {
  minimumSermons: number;
  maximumDeadLetterSermonRate: number;
  maximumFallbackSermonRate: number;
  maximumProvenanceFailureRate: number;
  maximumPublishedWithoutExplicitIntent: number;
  maximumFirstBrandedP90Milliseconds: number;
};

export type PilotStopCondition = {
  key: "MINIMUM_SAMPLE" | "DEAD_LETTERS" | "FALLBACK" | "PROVENANCE" | "PUBLISH_WITHOUT_INTENT" | "FIRST_BRANDED_P90";
  state: "PASS" | "BREACHED" | "INSUFFICIENT" | "UNKNOWN";
  observed: number | null;
  threshold: number;
};

export function evaluatePilotStopConditions(
  summary: PilotJourneyTelemetrySummary,
  thresholds: PilotStopThresholds,
): {
  evidenceScope: "PILOT_EVIDENCE_NOT_READINESS_PROOF";
  readinessConclusion: "NOT_PROVIDED";
  stopRecommended: boolean;
  conditions: PilotStopCondition[];
} {
  const rateCondition = (
    key: PilotStopCondition["key"],
    evidence: RateEvidence,
    threshold: number,
  ): PilotStopCondition => evidence.state === "UNKNOWN"
    ? { key, state: "UNKNOWN", observed: null, threshold }
    : { key, state: evidence.value! > threshold ? "BREACHED" : "PASS", observed: evidence.value, threshold };
  const branded = summary.durations.firstPlayableBrandedClip;
  const conditions: PilotStopCondition[] = [
    {
      key: "MINIMUM_SAMPLE",
      state: summary.denominators.sermons >= thresholds.minimumSermons ? "PASS" : "INSUFFICIENT",
      observed: summary.denominators.sermons,
      threshold: thresholds.minimumSermons,
    },
    rateCondition("DEAD_LETTERS", summary.rates.sermonsWithDeadLetters, thresholds.maximumDeadLetterSermonRate),
    rateCondition("FALLBACK", summary.rates.sermonsUsingFallback, thresholds.maximumFallbackSermonRate),
    rateCondition("PROVENANCE", summary.rates.provenanceFailures, thresholds.maximumProvenanceFailureRate),
    {
      key: "PUBLISH_WITHOUT_INTENT",
      state: summary.totals.publishedWithoutExplicitIntent > thresholds.maximumPublishedWithoutExplicitIntent ? "BREACHED" : "PASS",
      observed: summary.totals.publishedWithoutExplicitIntent,
      threshold: thresholds.maximumPublishedWithoutExplicitIntent,
    },
    {
      key: "FIRST_BRANDED_P90",
      state: branded.state === "KNOWN"
        ? branded.p90Milliseconds! > thresholds.maximumFirstBrandedP90Milliseconds ? "BREACHED" : "PASS"
        : branded.state,
      observed: branded.state === "KNOWN" ? branded.p90Milliseconds : null,
      threshold: thresholds.maximumFirstBrandedP90Milliseconds,
    },
  ];
  const cohortSampleIsSufficient = summary.denominators.sermons >= thresholds.minimumSermons;
  if (!cohortSampleIsSufficient) {
    for (const condition of conditions) {
      if (condition.key === "MINIMUM_SAMPLE" || condition.state === "UNKNOWN") continue;
      const observedZeroToleranceBreach = condition.threshold === 0
        && condition.observed !== null
        && condition.observed > 0;
      condition.state = observedZeroToleranceBreach ? "BREACHED" : "INSUFFICIENT";
    }
  }
  return {
    evidenceScope: "PILOT_EVIDENCE_NOT_READINESS_PROOF",
    readinessConclusion: "NOT_PROVIDED",
    stopRecommended: conditions.some((condition) => condition.state === "BREACHED"),
    conditions,
  };
}
