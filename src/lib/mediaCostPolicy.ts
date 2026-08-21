export const MEDIA_COST_SAFETY_POLICY = {
  eagerPreviewLimit: 3,
  remainingPreviewMode: "ON_DEMAND",
  contentWeekMode: "ON_DEMAND",
  finalRenderMode: "APPROVAL_GATED",
  publishingMode: "EXPLICIT_INTENT",
  artifactReuseMode: "REUSE_MATCHING_FRESH_ARTIFACT",
  lifecycleMode: "OBSERVE_ONLY",
  automaticDeletionEnabled: false,
} as const;

export type SourceWindowSignal = {
  status: "BOUNDED" | "FULL_RECORDING" | "PARTIAL" | "UNKNOWN_DURATION" | "INVALID";
  sourceDurationSeconds: number | null;
  analysisWindowSeconds: number | null;
  potentialAvoidedSeconds: number | null;
  message: string;
};

function validSeconds(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function assessSourceWindow(input: {
  sourceDurationSeconds?: number | null;
  sermonStartSeconds?: number | null;
  sermonEndSeconds?: number | null;
  analyzeFullRecording?: boolean;
}): SourceWindowSignal {
  const duration = validSeconds(input.sourceDurationSeconds)
    ? input.sourceDurationSeconds
    : null;
  const start = validSeconds(input.sermonStartSeconds)
    ? input.sermonStartSeconds
    : null;
  const end = validSeconds(input.sermonEndSeconds)
    ? input.sermonEndSeconds
    : null;

  if (input.analyzeFullRecording === true || (start === null && end === null)) {
    return {
      status: duration === null ? "UNKNOWN_DURATION" : "FULL_RECORDING",
      sourceDurationSeconds: duration,
      analysisWindowSeconds: duration,
      potentialAvoidedSeconds: 0,
      message: duration === null
        ? "The full recording is selected, but its duration has not been recorded."
        : "The full recording is selected for analysis.",
    };
  }

  if (start === null || end === null) {
    return {
      status: "PARTIAL",
      sourceDurationSeconds: duration,
      analysisWindowSeconds: null,
      potentialAvoidedSeconds: null,
      message: "Only one sermon boundary is recorded; confirm both ends before relying on a reduced analysis window.",
    };
  }

  if (end <= start || (duration !== null && (start > duration || end > duration))) {
    return {
      status: "INVALID",
      sourceDurationSeconds: duration,
      analysisWindowSeconds: null,
      potentialAvoidedSeconds: null,
      message: "The saved sermon boundaries do not form a valid window inside the recording.",
    };
  }

  const analysisWindowSeconds = end - start;
  return {
    status: duration === null ? "UNKNOWN_DURATION" : "BOUNDED",
    sourceDurationSeconds: duration,
    analysisWindowSeconds,
    potentialAvoidedSeconds: duration === null
      ? null
      : Math.max(0, duration - analysisWindowSeconds),
    message: duration === null
      ? "Both sermon boundaries are recorded; source duration is still needed to quantify the reduction."
      : "Both sermon boundaries are recorded, so downstream work can stay inside the preaching section.",
  };
}

export type InventoryCoverage = {
  recordCount: number;
  recordsWithSize: number;
  knownBytes: bigint;
  coveragePercent: number | null;
  completeness: "EMPTY" | "COMPLETE_METADATA" | "PARTIAL_METADATA";
};

export function assessInventoryCoverage(input: {
  recordCount: number;
  recordsWithSize: number;
  knownBytes: bigint;
}): InventoryCoverage {
  const recordCount = Math.max(0, Math.floor(input.recordCount));
  const recordsWithSize = Math.min(
    recordCount,
    Math.max(0, Math.floor(input.recordsWithSize)),
  );
  const knownBytes = input.knownBytes > BigInt(0) ? input.knownBytes : BigInt(0);
  if (recordCount === 0) {
    return {
      recordCount,
      recordsWithSize,
      knownBytes,
      coveragePercent: null,
      completeness: "EMPTY",
    };
  }
  const coveragePercent = Math.round((recordsWithSize / recordCount) * 100);
  return {
    recordCount,
    recordsWithSize,
    knownBytes,
    coveragePercent,
    completeness: recordsWithSize === recordCount
      ? "COMPLETE_METADATA"
      : "PARTIAL_METADATA",
  };
}
