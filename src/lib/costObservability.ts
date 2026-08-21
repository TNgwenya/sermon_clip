import { assessInventoryCoverage, assessSourceWindow, type InventoryCoverage } from "@/lib/mediaCostPolicy";

export const COST_ALLOWANCE_METRICS = [
  { entitlementKey: "ai.tokens.monthly", metric: "ai.tokens", label: "AI tokens", unit: "tokens" },
  { entitlementKey: "ai.audio_seconds.monthly", metric: "ai.audio_seconds", label: "Transcription audio", unit: "seconds" },
  { entitlementKey: "media.seconds.monthly", metric: "media.seconds", label: "Media processing", unit: "seconds" },
  { entitlementKey: "storage.bytes", metric: "storage.bytes", label: "Stored media", unit: "bytes" },
] as const;

export type CostSourceRecord = {
  sourceDurationSeconds: number | null;
  sermonStartSeconds: number | null;
  sermonEndSeconds: number | null;
  analyzeFullRecording: boolean;
};

export type CostAiRecord = {
  provider: string;
  model: string;
  operation: string;
  sermonId: string | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  audioDurationSeconds: number | null;
  estimatedCostMicros: bigint | null;
  providerRequestCount: number;
  cacheHit: boolean;
};

export type CostProcessingRecord = {
  sermonId: string;
  jobType: string;
  status: string;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  attemptCount: number;
};

export type AllowanceInput = {
  key: string;
  enabled: boolean;
  limitValue: bigint | null;
};

export type UsageInput = {
  metric: string;
  quantity: bigint;
};

export type InventoryInput = {
  label: string;
  recordCount: number;
  recordsWithSize: number;
  knownBytes: bigint;
};

export type AllowanceStatus = {
  entitlementKey: string;
  metric: string;
  label: string;
  unit: string;
  used: bigint;
  eventCount: number;
  limit: bigint | null;
  status: "NOT_CONFIGURED" | "DISABLED" | "NO_METER_EVENTS" | "TRACKING" | "OK" | "WARNING" | "EXCEEDED";
  message: string;
};

export type CostMediaWarning = {
  code: string;
  severity: "INFO" | "WARNING";
  message: string;
};

export type WorkspaceCostObservability = {
  window: { from: Date; until: Date };
  measured: {
    sermonCount: number;
    sourcesWithKnownDuration: number;
    sourceDurationSeconds: number;
    boundedSourceCount: number;
    fullOrUnknownSourceCount: number;
    aiInvocationCount: number;
    aiInvocationsWithTokenUsage: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    totalTokens: number;
    transcriptionAudioSeconds: number;
    cacheHits: number;
    providerRequestCount: number;
    sermonAttributedInvocations: number;
    sermonAttributionCoveragePercent: number | null;
    processingJobCount: number;
    processingJobsWithRunDuration: number;
    processingRunSeconds: number;
    processingQueueSeconds: number;
    inventory: InventoryCoverage;
    inventoryCategories: Array<InventoryCoverage & { label: string }>;
  };
  estimated: {
    aiCostMicros: bigint;
    aiInvocationsWithCostEstimate: number;
    potentialAvoidedMediaSeconds: number;
  };
  allowances: AllowanceStatus[];
  workloadBreakdown: Array<{
    key: string;
    operation: string;
    provider: string;
    model: string;
    invocationCount: number;
    totalTokens: number;
    audioDurationSeconds: number;
    providerRequestCount: number;
    cacheHitCount: number;
    costEstimateMicros: bigint;
    costEstimateCoverageCount: number;
    sermonAttributionCount: number;
  }>;
  processingStageBreakdown: Array<{
    jobType: string;
    jobCount: number;
    succeededCount: number;
    failedCount: number;
    attemptCount: number;
    jobsWithRunDuration: number;
    runDurationSeconds: number;
    queueDurationSeconds: number;
  }>;
  warnings: CostMediaWarning[];
};

export function calendarMonthWindow(now: Date): { from: Date; until: Date } {
  if (Number.isNaN(now.getTime())) throw new Error("A valid reporting date is required.");
  return {
    from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    until: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

function safeNumber(value: number | null): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function allowanceStatuses(input: {
  entitlements: AllowanceInput[];
  usageEvents: UsageInput[];
  activity: Record<string, boolean>;
}): AllowanceStatus[] {
  return COST_ALLOWANCE_METRICS.map((definition) => {
    const entitlement = input.entitlements.find((item) => item.key === definition.entitlementKey);
    const events = input.usageEvents.filter((item) => item.metric === definition.metric);
    const used = events.reduce((total, event) => total + event.quantity, BigInt(0));
    const base = {
      entitlementKey: definition.entitlementKey,
      metric: definition.metric,
      label: definition.label,
      unit: definition.unit,
      used,
      eventCount: events.length,
      limit: entitlement?.limitValue ?? null,
    };
    if (!entitlement) {
      return { ...base, status: "NOT_CONFIGURED", message: "No allowance is configured; this is observation only." };
    }
    if (!entitlement.enabled) {
      return { ...base, status: "DISABLED", message: "This allowance is disabled." };
    }
    if (events.length === 0 && input.activity[definition.metric]) {
      return { ...base, status: "NO_METER_EVENTS", message: "Related activity exists, but no matching usage meter events were recorded. Do not read this as zero usage." };
    }
    if (entitlement.limitValue === null) {
      return { ...base, status: "TRACKING", message: "Usage is recorded without a configured limit." };
    }
    if (used > entitlement.limitValue) {
      return { ...base, status: "EXCEEDED", message: "Recorded usage is above the configured allowance." };
    }
    const nearLimit = entitlement.limitValue > BigInt(0)
      && used * BigInt(100) >= entitlement.limitValue * BigInt(80);
    return {
      ...base,
      status: nearLimit ? "WARNING" : "OK",
      message: nearLimit
        ? "Recorded usage has reached at least 80% of the configured allowance."
        : "Recorded usage is within the configured allowance.",
    };
  });
}

export function buildWorkspaceCostObservability(input: {
  now: Date;
  sources: CostSourceRecord[];
  aiInvocations: CostAiRecord[];
  processingJobs: CostProcessingRecord[];
  entitlements: AllowanceInput[];
  usageEvents: UsageInput[];
  inventory: InventoryInput[];
}): WorkspaceCostObservability {
  const sourceSignals = input.sources.map(assessSourceWindow);
  const inventoryCategories = input.inventory.map((category) => ({
    label: category.label,
    ...assessInventoryCoverage(category),
  }));
  const inventory = assessInventoryCoverage({
    recordCount: inventoryCategories.reduce((total, item) => total + item.recordCount, 0),
    recordsWithSize: inventoryCategories.reduce((total, item) => total + item.recordsWithSize, 0),
    knownBytes: inventoryCategories.reduce((total, item) => total + item.knownBytes, BigInt(0)),
  });
  const workloadGroups = new Map<string, WorkspaceCostObservability["workloadBreakdown"][number]>();
  for (const invocation of input.aiInvocations) {
    const key = `${invocation.operation}\u0000${invocation.provider}\u0000${invocation.model}`;
    const current = workloadGroups.get(key) ?? {
      key,
      operation: invocation.operation,
      provider: invocation.provider,
      model: invocation.model,
      invocationCount: 0,
      totalTokens: 0,
      audioDurationSeconds: 0,
      providerRequestCount: 0,
      cacheHitCount: 0,
      costEstimateMicros: BigInt(0),
      costEstimateCoverageCount: 0,
      sermonAttributionCount: 0,
    };
    current.invocationCount += 1;
    current.totalTokens += safeNumber(invocation.totalTokens);
    current.audioDurationSeconds += safeNumber(invocation.audioDurationSeconds);
    current.providerRequestCount += Math.floor(safeNumber(invocation.providerRequestCount));
    current.cacheHitCount += invocation.cacheHit ? 1 : 0;
    current.costEstimateMicros += invocation.estimatedCostMicros ?? BigInt(0);
    current.costEstimateCoverageCount += invocation.estimatedCostMicros === null ? 0 : 1;
    current.sermonAttributionCount += invocation.sermonId ? 1 : 0;
    workloadGroups.set(key, current);
  }
  const workloadBreakdown = Array.from(workloadGroups.values()).sort((a, b) => (
    b.invocationCount - a.invocationCount || a.operation.localeCompare(b.operation)
  ));
  const processingGroups = new Map<string, WorkspaceCostObservability["processingStageBreakdown"][number]>();
  for (const job of input.processingJobs) {
    const current = processingGroups.get(job.jobType) ?? {
      jobType: job.jobType,
      jobCount: 0,
      succeededCount: 0,
      failedCount: 0,
      attemptCount: 0,
      jobsWithRunDuration: 0,
      runDurationSeconds: 0,
      queueDurationSeconds: 0,
    };
    const runDurationMs = job.startedAt && job.completedAt
      ? job.completedAt.getTime() - job.startedAt.getTime()
      : null;
    const queueDurationMs = job.startedAt
      ? job.startedAt.getTime() - job.createdAt.getTime()
      : null;
    current.jobCount += 1;
    current.succeededCount += job.status === "SUCCEEDED" ? 1 : 0;
    current.failedCount += job.status === "FAILED" ? 1 : 0;
    current.attemptCount += Math.max(0, Math.floor(job.attemptCount));
    if (runDurationMs !== null && Number.isFinite(runDurationMs) && runDurationMs >= 0) {
      current.jobsWithRunDuration += 1;
      current.runDurationSeconds += runDurationMs / 1_000;
    }
    if (queueDurationMs !== null && Number.isFinite(queueDurationMs) && queueDurationMs >= 0) {
      current.queueDurationSeconds += queueDurationMs / 1_000;
    }
    processingGroups.set(job.jobType, current);
  }
  const processingStageBreakdown = Array.from(processingGroups.values()).sort((a, b) => (
    b.runDurationSeconds - a.runDurationSeconds || a.jobType.localeCompare(b.jobType)
  ));
  const measured = {
    sermonCount: input.sources.length,
    sourcesWithKnownDuration: sourceSignals.filter((signal) => signal.sourceDurationSeconds !== null).length,
    sourceDurationSeconds: sourceSignals.reduce((total, signal) => total + (signal.sourceDurationSeconds ?? 0), 0),
    boundedSourceCount: sourceSignals.filter((signal) => signal.status === "BOUNDED").length,
    fullOrUnknownSourceCount: sourceSignals.filter((signal) => signal.status !== "BOUNDED").length,
    aiInvocationCount: input.aiInvocations.length,
    aiInvocationsWithTokenUsage: input.aiInvocations.filter((record) => record.totalTokens !== null).length,
    inputTokens: input.aiInvocations.reduce((total, record) => total + safeNumber(record.inputTokens), 0),
    cachedInputTokens: input.aiInvocations.reduce((total, record) => total + safeNumber(record.cachedInputTokens), 0),
    outputTokens: input.aiInvocations.reduce((total, record) => total + safeNumber(record.outputTokens), 0),
    totalTokens: input.aiInvocations.reduce((total, record) => total + safeNumber(record.totalTokens), 0),
    transcriptionAudioSeconds: input.aiInvocations.reduce((total, record) => total + safeNumber(record.audioDurationSeconds), 0),
    cacheHits: input.aiInvocations.filter((record) => record.cacheHit).length,
    providerRequestCount: input.aiInvocations.reduce((total, record) => total + Math.floor(safeNumber(record.providerRequestCount)), 0),
    sermonAttributedInvocations: input.aiInvocations.filter((record) => Boolean(record.sermonId)).length,
    sermonAttributionCoveragePercent: input.aiInvocations.length === 0
      ? null
      : Math.round((input.aiInvocations.filter((record) => Boolean(record.sermonId)).length / input.aiInvocations.length) * 100),
    processingJobCount: input.processingJobs.length,
    processingJobsWithRunDuration: processingStageBreakdown.reduce((total, stage) => total + stage.jobsWithRunDuration, 0),
    processingRunSeconds: processingStageBreakdown.reduce((total, stage) => total + stage.runDurationSeconds, 0),
    processingQueueSeconds: processingStageBreakdown.reduce((total, stage) => total + stage.queueDurationSeconds, 0),
    inventory,
    inventoryCategories,
  };
  const estimated = {
    aiCostMicros: input.aiInvocations.reduce((total, record) => total + (record.estimatedCostMicros ?? BigInt(0)), BigInt(0)),
    aiInvocationsWithCostEstimate: input.aiInvocations.filter((record) => record.estimatedCostMicros !== null).length,
    potentialAvoidedMediaSeconds: sourceSignals.reduce((total, signal) => total + (signal.potentialAvoidedSeconds ?? 0), 0),
  };
  const allowances = allowanceStatuses({
    entitlements: input.entitlements,
    usageEvents: input.usageEvents,
    activity: {
      "ai.tokens": measured.totalTokens > 0,
      "ai.audio_seconds": measured.transcriptionAudioSeconds > 0,
      "media.seconds": measured.inventory.recordCount > 0,
      "storage.bytes": measured.inventory.knownBytes > BigInt(0),
    },
  });
  const warnings: CostMediaWarning[] = [];
  if (measured.sermonCount > measured.sourcesWithKnownDuration) {
    warnings.push({
      code: "SOURCE_DURATION_COVERAGE",
      severity: "WARNING",
      message: `${measured.sermonCount - measured.sourcesWithKnownDuration} sermon source(s) added this month do not have recorded duration, so media-volume attribution is incomplete.`,
    });
  }
  if (measured.fullOrUnknownSourceCount > 0) {
    warnings.push({
      code: "SOURCE_WINDOW_COVERAGE",
      severity: "INFO",
      message: `${measured.fullOrUnknownSourceCount} sermon source(s) added this month are not confirmed as bounded preaching windows.`,
    });
  }
  if (measured.inventory.completeness === "PARTIAL_METADATA") {
    warnings.push({
      code: "INVENTORY_METADATA_COVERAGE",
      severity: "WARNING",
      message: `${measured.inventory.recordCount - measured.inventory.recordsWithSize} recorded media artefact(s) have no size metadata. The inventory total is a lower bound, not provider storage usage.`,
    });
  }
  if (estimated.aiInvocationsWithCostEstimate < measured.aiInvocationCount) {
    warnings.push({
      code: "AI_ESTIMATE_COVERAGE",
      severity: "WARNING",
      message: `${measured.aiInvocationCount - estimated.aiInvocationsWithCostEstimate} AI invocation(s) have no stored cost estimate. The estimate is incomplete and is not an invoice.`,
    });
  }
  if (measured.processingJobsWithRunDuration < measured.processingJobCount) {
    warnings.push({
      code: "PROCESSING_DURATION_COVERAGE",
      severity: "WARNING",
      message: `${measured.processingJobCount - measured.processingJobsWithRunDuration} processing job(s) created this month do not have a complete start-to-finish duration. Stage time is measured wall time where available, not billed compute time.`,
    });
  }
  for (const allowance of allowances) {
    if (["NO_METER_EVENTS", "WARNING", "EXCEEDED"].includes(allowance.status)) {
      warnings.push({
        code: `ALLOWANCE_${allowance.metric.toUpperCase().replace(/\./g, "_")}`,
        severity: "WARNING",
        message: `${allowance.label}: ${allowance.message}`,
      });
    }
  }
  return {
    window: calendarMonthWindow(input.now),
    measured,
    estimated,
    allowances,
    workloadBreakdown,
    processingStageBreakdown,
    warnings,
  };
}

export function formatDurationCompact(seconds: number): string {
  const minutes = Math.max(0, seconds) / 60;
  if (minutes < 60) return `${Math.round(minutes)} min`;
  return `${(minutes / 60).toFixed(minutes >= 600 ? 0 : 1)} hr`;
}

export function formatBytesCompact(bytes: bigint): string {
  const value = bytes > BigInt(0) ? bytes : BigInt(0);
  const units = ["B", "KB", "MB", "GB", "TB"];
  let unitIndex = 0;
  let divisor = BigInt(1);
  while (unitIndex < units.length - 1 && value >= divisor * BigInt(1024)) {
    divisor *= BigInt(1024);
    unitIndex += 1;
  }
  if (unitIndex === 0) return `${value} B`;
  const tenths = (value * BigInt(10)) / divisor;
  return `${tenths / BigInt(10)}.${tenths % BigInt(10)} ${units[unitIndex]}`;
}

export function formatEstimatedUsdMicros(micros: bigint): string {
  const safe = micros > BigInt(0) ? micros : BigInt(0);
  const cents = (safe + BigInt(5_000)) / BigInt(10_000);
  return `$${cents / BigInt(100)}.${String(cents % BigInt(100)).padStart(2, "0")}`;
}
