export type TranscriptReviewEvidenceView = {
  languageProfile: "ENGLISH" | "NGUNI_LOCAL" | "SOTHO_TSWANA" | "MIXED" | "UNKNOWN";
  confidenceBand: "HIGH" | "REVIEW" | "LOW" | "UNKNOWN";
  codeSwitchingDetected: boolean;
  reviewReasons: Array<{ code: string; message: string }>;
  uncertainRegions: Array<{
    startTimeSeconds: number;
    endTimeSeconds: number;
    text: string;
    reasons: string[];
  }>;
};

export type TranscriptReviewGuidance = {
  title: string;
  summary: string;
  actionLabel: string;
  reasonLabels: string[];
};

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const LANGUAGE_PROFILES = new Set(["ENGLISH", "NGUNI_LOCAL", "SOTHO_TSWANA", "MIXED", "UNKNOWN"]);
const CONFIDENCE_BANDS = new Set(["HIGH", "REVIEW", "LOW", "UNKNOWN"]);

export function extractTranscriptReviewEvidence(snapshot: unknown): TranscriptReviewEvidenceView | null {
  const root = object(snapshot);
  const evidence = object(root?.["transcriptEvidence"]);
  if (!evidence) return null;

  const languageProfile = typeof evidence["languageProfile"] === "string" && LANGUAGE_PROFILES.has(evidence["languageProfile"])
    ? evidence["languageProfile"] as TranscriptReviewEvidenceView["languageProfile"]
    : "UNKNOWN";
  const confidenceBand = typeof evidence["confidenceBand"] === "string" && CONFIDENCE_BANDS.has(evidence["confidenceBand"])
    ? evidence["confidenceBand"] as TranscriptReviewEvidenceView["confidenceBand"]
    : "UNKNOWN";
  const codeSwitching = object(evidence["codeSwitching"]);
  const reviewReasons = Array.isArray(evidence["reviewReasons"])
    ? evidence["reviewReasons"].flatMap((value) => {
        const reason = object(value);
        return typeof reason?.["code"] === "string" && typeof reason["message"] === "string"
          ? [{ code: reason["code"], message: reason["message"] }]
          : [];
      })
    : [];
  const uncertainRegions = Array.isArray(evidence["uncertainRegions"])
    ? evidence["uncertainRegions"].flatMap((value) => {
        const region = object(value);
        const startTimeSeconds = finiteNumber(region?.["startTimeSeconds"]);
        const endTimeSeconds = finiteNumber(region?.["endTimeSeconds"]);
        if (startTimeSeconds === null || endTimeSeconds === null || typeof region?.["text"] !== "string") {
          return [];
        }
        return [{
          startTimeSeconds,
          endTimeSeconds,
          text: region["text"],
          reasons: Array.isArray(region["reasons"])
            ? region["reasons"].filter((reason): reason is string => typeof reason === "string")
            : [],
        }];
      })
    : [];

  return {
    languageProfile,
    confidenceBand,
    codeSwitchingDetected: codeSwitching?.["detected"] === true,
    reviewReasons,
    uncertainRegions,
  };
}

const SAFETY_REASON_LABELS: Record<string, string> = {
  LOCAL_LANGUAGE_TRANSCRIPT_UNCERTAIN: "Local-language wording has not been verified",
  LOCAL_LANGUAGE_DETECTED: "Local-language wording detected",
  CODE_SWITCHING_DETECTED: "Language change detected",
  LOW_CONFIDENCE_TRANSCRIPT_REGION: "Some wording has lower transcription confidence",
  MISSING_TRANSCRIPT_CONFIDENCE: "Provider confidence is incomplete",
  UNKNOWN_TRANSCRIPT_LANGUAGE: "Language could not be identified safely",
  LOW_TRANSCRIPT_RESCUE: "Transcript was recovered from limited evidence",
  MANUAL_TRANSCRIPT_RESCUE: "Transcript needs a manual wording check",
  LOW_TRANSCRIPT_TIMED_FALLBACK: "Timing came from a transcript fallback",
  TRANSCRIPT_CHANGED_AFTER_CLIP_GENERATION: "Transcript changed after this clip was created",
};

export function buildTranscriptReviewGuidance(input: {
  transcriptSafetyReasons: string[];
  evidence?: TranscriptReviewEvidenceView | null;
  boundaryQuality?: "GOOD" | "NEEDS_REVIEW" | "BAD" | null;
}): TranscriptReviewGuidance {
  const reasonLabels = Array.from(new Set([
    ...input.transcriptSafetyReasons.map((reason) => SAFETY_REASON_LABELS[reason]).filter(Boolean),
    ...(input.evidence?.reviewReasons.map((reason) => reason.message) ?? []),
  ]));

  if (input.evidence?.codeSwitchingDetected || input.transcriptSafetyReasons.includes("CODE_SWITCHING_DETECTED")) {
    return {
      title: "Check the words around the language change",
      summary: "Listen to the excerpt and confirm that both languages are written exactly as spoken. Sermon Clip has not translated this wording.",
      actionLabel: "I listened and checked these words",
      reasonLabels,
    };
  }

  if (input.evidence?.confidenceBand === "LOW" || input.transcriptSafetyReasons.includes("LOW_CONFIDENCE_TRANSCRIPT_REGION")) {
    return {
      title: "Check the uncertain wording against the audio",
      summary: "Part of this excerpt has lower transcription confidence. Confirm the exact wording before captions or export.",
      actionLabel: "I listened and checked these words",
      reasonLabels,
    };
  }

  if (input.transcriptSafetyReasons.includes("TRANSCRIPT_CHANGED_AFTER_CLIP_GENERATION")) {
    return {
      title: "The transcript changed—check this clip again",
      summary: "Review the updated wording and make sure the opening and ending still preserve the pastor’s complete thought.",
      actionLabel: "I checked the updated transcript",
      reasonLabels,
    };
  }

  return {
    title: input.boundaryQuality === "GOOD" ? "Check the wording before approval" : "Check the wording and clip boundaries",
    summary: "Read and listen to the exact excerpt below. Confirm local-language words and ministry context before continuing.",
    actionLabel: "I listened and checked these words",
    reasonLabels,
  };
}
