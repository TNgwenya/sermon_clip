export type ParsedTimestampResult = {
  seconds: number | null;
  error?: string;
};

export type SegmentValidationInput = {
  sermonStartSeconds: number | null;
  sermonEndSeconds: number | null;
  knownDurationSeconds?: number | null;
};

export type SegmentValidationResult = {
  isValid: boolean;
  startError?: string;
  endError?: string;
};

const LONG_RECORDING_THRESHOLD_SECONDS = 60 * 60;

function parseTimestampParts(value: string): number[] | null {
  const parts = value.split(":").map((part) => part.trim());
  if (parts.length < 2 || parts.length > 3) {
    return null;
  }

  const lastPartIndex = parts.length - 1;
  if (!parts.every((part, index) => (index === lastPartIndex ? /^\d+(?:\.\d{1,3})?$/.test(part) : /^\d+$/.test(part)))) {
    return null;
  }

  return parts.map((part) => Number(part));
}

export function parseSermonTimestampInput(value: string): ParsedTimestampResult {
  const normalized = value.trim();
  if (!normalized) {
    return { seconds: null };
  }

  const parts = parseTimestampParts(normalized);
  if (!parts) {
    return {
      seconds: null,
      error: "Use a format like 52:30 or 1:12:45.",
    };
  }

  if (parts.length === 2) {
    const [minutes, seconds] = parts;
    if (seconds >= 60) {
      return {
        seconds: null,
        error: "Use a format like 52:30 or 1:12:45.",
      };
    }

    return { seconds: minutes * 60 + seconds };
  }

  const [hours, minutes, seconds] = parts;
  if (minutes >= 60 || seconds >= 60) {
    return {
      seconds: null,
      error: "Use a format like 52:30 or 1:12:45.",
    };
  }

  return {
    seconds: hours * 3600 + minutes * 60 + seconds,
  };
}

export function formatSecondsForPastorView(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

export function formatSecondsForTimestampInput(seconds: number): string {
  const safeMilliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(safeMilliseconds / 3600000);
  const minutes = Math.floor((safeMilliseconds % 3600000) / 60000);
  const wholeSeconds = Math.floor((safeMilliseconds % 60000) / 1000);
  const milliseconds = safeMilliseconds % 1000;
  const secondsLabel = milliseconds > 0
    ? `${String(wholeSeconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0").replace(/0+$/g, "")}`
    : String(wholeSeconds).padStart(2, "0");

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${secondsLabel}`;
  }

  return `${minutes}:${secondsLabel}`;
}

export function validateSermonSegmentRange(input: SegmentValidationInput): SegmentValidationResult {
  const { sermonStartSeconds, sermonEndSeconds, knownDurationSeconds } = input;

  if (sermonStartSeconds !== null && sermonStartSeconds < 0) {
    return {
      isValid: false,
      startError: "Sermon start time must be 0 or greater.",
    };
  }

  if (sermonEndSeconds !== null && sermonEndSeconds < 0) {
    return {
      isValid: false,
      endError: "Sermon end time must be 0 or greater.",
    };
  }

  if (sermonStartSeconds !== null && sermonEndSeconds !== null && sermonEndSeconds <= sermonStartSeconds) {
    return {
      isValid: false,
      endError: "Sermon end time must be after the start time.",
    };
  }

  if (typeof knownDurationSeconds === "number" && Number.isFinite(knownDurationSeconds) && knownDurationSeconds > 0) {
    if (sermonStartSeconds !== null && sermonStartSeconds > knownDurationSeconds) {
      return {
        isValid: false,
        startError: "Sermon start time is longer than the video duration.",
      };
    }

    if (sermonEndSeconds !== null && sermonEndSeconds > knownDurationSeconds) {
      return {
        isValid: false,
        endError: "Sermon end time is longer than the video duration.",
      };
    }
  }

  return { isValid: true };
}

export function shouldShowLongRecordingWarning(durationSeconds: number | null | undefined): boolean {
  return typeof durationSeconds === "number" && Number.isFinite(durationSeconds) && durationSeconds >= LONG_RECORDING_THRESHOLD_SECONDS;
}

export function hasSermonSegmentWindow(
  sermonStartSeconds: number | null | undefined,
  sermonEndSeconds: number | null | undefined,
  analyzeFullRecording: boolean | null | undefined,
): boolean {
  if (analyzeFullRecording) {
    return false;
  }

  return typeof sermonStartSeconds === "number" || typeof sermonEndSeconds === "number";
}

export function toSermonSegmentRelativeRange(
  startTimeSeconds: number,
  endTimeSeconds: number,
  sermonStartSeconds: number | null | undefined,
): { startTimeSeconds: number; endTimeSeconds: number } | null {
  if (typeof sermonStartSeconds !== "number") {
    return null;
  }

  return {
    startTimeSeconds: Math.max(0, startTimeSeconds - sermonStartSeconds),
    endTimeSeconds: Math.max(0, endTimeSeconds - sermonStartSeconds),
  };
}
