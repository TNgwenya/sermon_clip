export const CAPTION_WARNING_CODES = [
  "CAPTIONS_TOO_FAST",
  "CAPTIONS_TOO_LONG",
  "CAPTIONS_OUT_OF_SAFE_ZONE",
  "MISSING_CAPTION_SEGMENTS",
  "CAPTION_TIMING_MISMATCH",
] as const;

export type CaptionWarningCode = typeof CAPTION_WARNING_CODES[number];

export type CaptionCue = {
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
  lineCount?: number;
  safeZoneOk?: boolean;
  contrastOk?: boolean;
  box?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  fontSizePx?: number;
  frameWidth?: number;
  frameHeight?: number;
};

export type CaptionQualityInput = {
  clipStartTimeSeconds: number;
  clipEndTimeSeconds: number;
  transcriptText: string;
  captionText?: string | null;
  cues?: CaptionCue[] | null;
  layout?: {
    safeZoneTop?: number;
    safeZoneBottom?: number;
    safeZoneX?: number;
    maxLines?: number;
    minFontSizePx?: number;
    contrastRatio?: number | null;
  } | null;
};

export type CaptionQualityResult = {
  captionQualityScore: number;
  captionWarnings: CaptionWarningCode[];
  captionReason: string;
};

function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(10, Number(value.toFixed(2))));
}

function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function cueLineCount(cue: CaptionCue): number {
  return cue.lineCount ?? Math.max(1, Math.ceil(cue.text.length / 32));
}

function isCueInSafeZone(cue: CaptionCue, layout: NonNullable<CaptionQualityInput["layout"]> | null | undefined): boolean {
  if (cue.safeZoneOk === false) {
    return false;
  }
  if (!cue.box) {
    return true;
  }

  const safeX = layout?.safeZoneX ?? 0.05;
  const safeTop = layout?.safeZoneTop ?? 0.08;
  const safeBottom = layout?.safeZoneBottom ?? 0.9;
  const right = cue.box.x + cue.box.width;
  const bottom = cue.box.y + cue.box.height;
  return cue.box.x >= safeX && right <= 1 - safeX && cue.box.y >= safeTop && bottom <= safeBottom;
}

export function parseCaptionDataCues(input: {
  captionData: unknown;
  clipStartTimeSeconds: number;
}): CaptionCue[] {
  if (!input.captionData || typeof input.captionData !== "object" || Array.isArray(input.captionData)) {
    return [];
  }

  const cues = (input.captionData as Record<string, unknown>).cues;
  if (!Array.isArray(cues)) {
    return [];
  }

  return cues.flatMap((cue) => {
    if (!cue || typeof cue !== "object" || Array.isArray(cue)) {
      return [];
    }
    const record = cue as Record<string, unknown>;
    const start = Number(record.startTimeSeconds ?? record.startSeconds);
    const end = Number(record.endTimeSeconds ?? record.endSeconds);
    const text = typeof record.text === "string" ? record.text : "";
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !text.trim()) {
      return [];
    }

    const isRelative = start < input.clipStartTimeSeconds;
    return [{
      startTimeSeconds: isRelative ? input.clipStartTimeSeconds + start : start,
      endTimeSeconds: isRelative ? input.clipStartTimeSeconds + end : end,
      text,
      lineCount: typeof record.lineCount === "number" ? record.lineCount : undefined,
      safeZoneOk: typeof record.safeZoneOk === "boolean" ? record.safeZoneOk : undefined,
      contrastOk: typeof record.contrastOk === "boolean" ? record.contrastOk : undefined,
    }];
  });
}

export function validateCaptionQuality(input: CaptionQualityInput): CaptionQualityResult {
  const warnings: CaptionWarningCode[] = [];
  let score = 8;
  const cues = input.cues ?? [];

  if (cues.length === 0) {
    const captionWords = words(input.captionText ?? "");
    const transcriptWords = words(input.transcriptText);
    if (captionWords.length === 0 || captionWords.length < Math.max(4, transcriptWords.length * 0.35)) {
      warnings.push("MISSING_CAPTION_SEGMENTS");
      score -= 2.4;
    }
    if (captionWords.length > 45) {
      warnings.push("CAPTIONS_TOO_LONG");
      score -= 1.1;
    }

    return {
      captionQualityScore: clampScore(score),
      captionWarnings: Array.from(new Set(warnings)),
      captionReason: warnings.length > 0
        ? "Caption text may need review before posting."
        : "Caption text is present and readable enough for a suggested clip.",
    };
  }

  const clipDuration = Math.max(0.1, input.clipEndTimeSeconds - input.clipStartTimeSeconds);
  const cueText = cues.map((cue) => cue.text).join(" ");
  const transcriptCoverage = normalizeText(input.transcriptText)
    ? normalizeText(cueText).length / Math.max(1, normalizeText(input.transcriptText).length)
    : 1;

  if (transcriptCoverage < 0.55) {
    warnings.push("MISSING_CAPTION_SEGMENTS");
    score -= 2;
  }

  for (const cue of cues) {
    const cueDuration = cue.endTimeSeconds - cue.startTimeSeconds;
    const cueWords = words(cue.text);
    const readingSpeed = cueWords.length / Math.max(0.1, cueDuration);

    if (cue.startTimeSeconds < input.clipStartTimeSeconds - 0.2 || cue.endTimeSeconds > input.clipEndTimeSeconds + 0.2 || cueDuration <= 0.2) {
      warnings.push("CAPTION_TIMING_MISMATCH");
      score -= 1.4;
    }
    if (readingSpeed > 3.7) {
      warnings.push("CAPTIONS_TOO_FAST");
      score -= 1.1;
    }
    if (cue.text.length > 84 || cueWords.length > 16 || cueLineCount(cue) > (input.layout?.maxLines ?? 2)) {
      warnings.push("CAPTIONS_TOO_LONG");
      score -= 0.9;
    }
    if (!isCueInSafeZone(cue, input.layout) || cue.contrastOk === false || (input.layout?.contrastRatio !== undefined && input.layout.contrastRatio !== null && input.layout.contrastRatio < 3)) {
      warnings.push("CAPTIONS_OUT_OF_SAFE_ZONE");
      score -= 1.2;
    }
    if (cue.fontSizePx !== undefined && cue.fontSizePx < (input.layout?.minFontSizePx ?? 38)) {
      warnings.push("CAPTIONS_TOO_LONG");
      score -= 0.8;
    }
  }

  const totalCaptionSeconds = cues.reduce((sum, cue) => sum + Math.max(0, cue.endTimeSeconds - cue.startTimeSeconds), 0);
  if (totalCaptionSeconds < clipDuration * 0.45) {
    warnings.push("MISSING_CAPTION_SEGMENTS");
    score -= 1.1;
  }

  return {
    captionQualityScore: clampScore(score),
    captionWarnings: Array.from(new Set(warnings)),
    captionReason: warnings.length > 0
      ? "Captions need review for timing, length, safe-zone, contrast, or readability. Video-pixel inspection is not available in this validator, so layout checks use caption metadata."
      : "Captions fit the clip timing and metadata-based readability checks. Video-pixel inspection is not available in this validator.",
  };
}
