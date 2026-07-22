"use client";

import { type MouseEvent, useEffect, useMemo, useRef, useState } from "react";

import { SectionCard, StatusBadge } from "@/components/ui";
import { formatSecondsForPastorView, formatSecondsForTimestampInput } from "@/lib/sermonSegment";
import {
  buildEditableCaptionCuesFromTranscriptSegments,
  buildTimedCaptionCuesFromTranscriptSegments,
  buildTimedCaptionCuesFromTranscriptWords,
  type CaptionSourceWord,
  type EditableCaptionCue,
  hashtagsToEditorInput,
  validateClipStudioTiming,
} from "@/lib/clipStudioEditing";
import {
  CLIP_STUDIO_TRANSCRIPT_COMMAND_EVENT,
  type ClipStudioTranscriptCommandDetail,
} from "@/lib/clipStudioTranscriptEvents";
import {
  CLIP_STUDIO_SPEECH_CLEANUP_EDIT_EVENT,
  type ClipStudioSpeechCleanupEditDetail,
} from "@/lib/clipStudioSpeechCleanupEvents";
import {
  CLIP_STUDIO_OVERLAY_POSITION_EVENT,
  type ClipStudioOverlayPositionDetail,
} from "@/lib/clipStudioOverlayEvents";
import {
  CLIP_STUDIO_LAYER_COMMAND_EVENT,
  type ClipStudioLayerCommandDetail,
} from "@/lib/clipStudioLayerEvents";
import { CAPTION_STYLE_PRESETS, resolveCaptionStylePreset } from "@/lib/captionStylePresets";
import {
  SPEECH_CLEANUP_INTENSITIES,
  SPEECH_CLEANUP_INTENSITY_LABELS,
  type BrollCardConfig,
  type BrollCardPosition,
  type BrollCardTone,
  type BrollLayerConfig,
  type CaptionAppearanceSettings,
  type CaptionFontScale,
  type CaptionMaxLines,
  type CaptionPosition,
  type CaptionRevealMode,
  type HookOverlayConfig,
  inferBrollCardTone,
  labelForBrollTone,
  normalizeCaptionSyncOffsetSeconds,
  normalizeHookOverlayForClipDuration,
  resolveNextBrollCardStart,
  type SpeechCleanupIntensity,
  type SpeechCleanupSettings,
} from "@/lib/clipStudio";
import {
  buildSpeechCleanupPreviewPlan,
  type SpeechCleanupAudioSilenceEvent,
} from "@/lib/clipStudioPreviewTimeline";
import {
  createSpeechCleanupEditsFromPlan,
  type SpeechCleanupEdits,
} from "@/lib/speechCleanupPlan";
import { useClipStudioPreview } from "@/app/sermons/[id]/clips/[clipId]/studio/clip-studio-preview-context";

type ClipStudioEditorProps = {
  initialStartTimeSeconds: number;
  initialEndTimeSeconds: number;
  initialTitle: string;
  initialEditorialHook: string;
  initialMainCaption: string;
  initialShortCaption: string;
  initialPlatformCaption: string;
  initialHashtags: string[];
  initialCaptionCues: EditableCaptionCue[];
  initialApplyCaptionsToClip: boolean;
  initialCaptionStylePresetId: string;
  initialCaptionPosition: CaptionPosition;
  initialCaptionAppearance: CaptionAppearanceSettings;
  initialCaptionRevealMode: CaptionRevealMode;
  initialCaptionSyncOffsetSeconds: number;
  brandCaptionStylePresetId: string;
  suggestedHook: string;
  suggestedCaption: string;
  titleOptions: string[];
  hookOptions: string[];
  ctaOptions: string[];
  initialHookOverlay: HookOverlayConfig;
  initialBrollLayer: BrollLayerConfig;
  initialSpeechCleanup: SpeechCleanupSettings;
  initialSpeechCleanupEdits: SpeechCleanupEdits | null;
  initialAudioSilenceEvents: SpeechCleanupAudioSilenceEvent[];
  initialAudioSilenceAnalyzed: boolean;
  audioSilenceReviewUrl: string | null;
  transcriptSegments: Array<{
    id: string;
    startTimeSeconds: number;
    endTimeSeconds: number;
    text: string;
  }>;
  transcriptWords?: CaptionSourceWord[];
  knownDurationSeconds: number | null;
  captionQualityScore: number | null;
  captionQualityReason: string | null;
  captionWarnings: string[];
  translationUncertainty: string | null;
  captionImprovementSuggestions: string[];
};

type TranscriptSegmentOption = ClipStudioEditorProps["transcriptSegments"][number];
type AudioSilenceReviewStatus = "idle" | "loading" | "ready" | "unavailable";

type DeferredAudioSilenceReview = {
  status: AudioSilenceReviewStatus;
  events: SpeechCleanupAudioSilenceEvent[];
  analyzed: boolean;
};

const QUICK_CLIP_LENGTH_SECONDS = [30, 45, 60, 90];
const EMPTY_AUDIO_SILENCE_EVENTS: SpeechCleanupAudioSilenceEvent[] = [];
const BROLL_TONE_OPTIONS: Array<{ value: BrollCardTone; label: string }> = [
  { value: "quote", label: "Quote" },
  { value: "scripture", label: "Scripture" },
  { value: "application", label: "Application" },
  { value: "context", label: "Context" },
];
const BROLL_POSITION_OPTIONS: Array<{ value: BrollCardPosition; label: string }> = [
  { value: "full", label: "Center feature" },
  { value: "upper", label: "Upper cutaway" },
  { value: "lower", label: "Lower cutaway" },
];

type CreatorReviewStatus = "ready" | "warning" | "needs-work";
type CreatorReviewPriority = "required" | "recommended" | "optional";

type CreatorReviewAction =
  | "fix-timing"
  | "enable-captions"
  | "tighten-captions"
  | "add-hook"
  | "fix-hook-timing"
  | "move-hook"
  | "add-broll"
  | "enable-audio"
  | "preview";

type CreatorReviewItem = {
  id: string;
  label: string;
  status: CreatorReviewStatus;
  detail: string;
  action?: CreatorReviewAction;
  actionLabel?: string;
};

type CreatorReviewChecklistItem = CreatorReviewItem & {
  priority: CreatorReviewPriority;
};

type StudioDraftSnapshot = {
  startTimestamp: string;
  endTimestamp: string;
  title: string;
  editorialHook: string;
  mainCaption: string;
  shortCaption: string;
  platformCaption: string;
  hashtags: string;
  applyCaptionsToClip: boolean;
  captionStylePresetId: string;
  captionPosition: CaptionPosition;
  captionAppearance: CaptionAppearanceSettings;
  captionRevealMode: CaptionRevealMode;
  captionSyncOffsetSeconds: number;
  captionCueTextEdits: Record<string, string>;
  hookOverlay: HookOverlayConfig;
  brollLayer: BrollLayerConfig;
  speechCleanup: SpeechCleanupSettings;
  speechCleanupEdits: SpeechCleanupEdits | null;
  firstSegmentId: string;
  lastSegmentId: string;
  focusedSegmentId: string;
};

type StudioDraftHistory = {
  past: StudioDraftSnapshot[];
  future: StudioDraftSnapshot[];
};

function findClosestTranscriptSegment(
  segments: TranscriptSegmentOption[],
  timeSeconds: number,
  boundary: "start" | "end",
): TranscriptSegmentOption | null {
  if (segments.length === 0 || !Number.isFinite(timeSeconds)) {
    return null;
  }

  return segments.reduce<TranscriptSegmentOption | null>((best, segment) => {
    const candidateTime = boundary === "start" ? segment.startTimeSeconds : segment.endTimeSeconds;
    if (!best) {
      return segment;
    }

    const bestTime = boundary === "start" ? best.startTimeSeconds : best.endTimeSeconds;
    const candidateDistance = Math.abs(candidateTime - timeSeconds);
    const bestDistance = Math.abs(bestTime - timeSeconds);
    return candidateDistance < bestDistance ? segment : best;
  }, null);
}

function getTimingGuidance(durationSeconds: number | null): {
  label: string;
  tone: "neutral" | "accent" | "warning" | "success" | "danger";
  description: string;
} {
  if (durationSeconds === null || durationSeconds <= 0) {
    return {
      label: "Timing pending",
      tone: "neutral",
      description: "Set a valid start and end before rendering.",
    };
  }

  if (durationSeconds < 30) {
    return {
      label: "Very short",
      tone: "warning",
      description: "Short clips need a very clear hook and landing.",
    };
  }

  if (durationSeconds <= 90) {
    return {
      label: "Short-form sweet spot",
      tone: "success",
      description: "This length usually works well for Reels, TikTok, and Shorts.",
    };
  }

  if (durationSeconds <= 120) {
    return {
      label: "Extended moment",
      tone: "accent",
      description: "Good for teaching, testimony, or scripture explanation.",
    };
  }

  return {
    label: "Long clip",
    tone: "warning",
    description: "Make sure the setup, payoff, and ending all earn the extra time.",
  };
}

function clampSeconds(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function formatCleanupDuration(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  if (safeSeconds === 0) {
    return "0s";
  }

  if (safeSeconds < 1) {
    return `${Math.max(0.1, safeSeconds).toFixed(1)}s`;
  }

  if (safeSeconds < 10 && !Number.isInteger(safeSeconds)) {
    return `${safeSeconds.toFixed(1)}s`;
  }

  return formatSecondsForPastorView(safeSeconds);
}

function getCaptionCueKey(cue: Pick<EditableCaptionCue, "startSeconds" | "endSeconds">): string {
  return `${Number(cue.startSeconds).toFixed(3)}-${Number(cue.endSeconds).toFixed(3)}`;
}

function buildCaptionCueTextEditSeed(cues: EditableCaptionCue[]): Record<string, string> {
  return cues.reduce<Record<string, string>>((edits, cue) => {
    edits[getCaptionCueKey(cue)] = cue.text;
    return edits;
  }, {});
}

function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function trimBrollText(value: string, maxLength = 180): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cloneStudioDraftSnapshot(snapshot: StudioDraftSnapshot): StudioDraftSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as StudioDraftSnapshot;
}

function getStudioDraftSnapshotKey(snapshot: StudioDraftSnapshot): string {
  return JSON.stringify(snapshot);
}

function getCreatorReviewStatusLabel(status: CreatorReviewStatus): string {
  if (status === "needs-work") {
    return "Needs work";
  }

  if (status === "warning") {
    return "Review";
  }

  return "Ready";
}

function getCreatorReviewStatusTone(status: CreatorReviewStatus): "success" | "warning" | "danger" {
  if (status === "needs-work") {
    return "danger";
  }

  if (status === "warning") {
    return "warning";
  }

  return "success";
}

function isKeyboardEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select";
}

function sanitizeAudioSilenceReviewEvents(value: unknown): SpeechCleanupAudioSilenceEvent[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }

    const event = item as Record<string, unknown>;
    const startSeconds = event["startSeconds"];
    const endSeconds = event["endSeconds"];
    const durationSeconds = event["durationSeconds"];
    if (
      typeof startSeconds !== "number" || !Number.isFinite(startSeconds) ||
      typeof endSeconds !== "number" || !Number.isFinite(endSeconds) ||
      typeof durationSeconds !== "number" || !Number.isFinite(durationSeconds) ||
      startSeconds < 0 || endSeconds <= startSeconds || durationSeconds < 0
    ) {
      return [];
    }

    return [{ startSeconds, endSeconds, durationSeconds }];
  });
}

export function ClipStudioEditor({
  initialStartTimeSeconds,
  initialEndTimeSeconds,
  initialTitle,
  initialEditorialHook,
  initialMainCaption,
  initialShortCaption,
  initialPlatformCaption,
  initialHashtags,
  initialCaptionCues,
  initialApplyCaptionsToClip,
  initialCaptionStylePresetId,
  initialCaptionPosition,
  initialCaptionAppearance,
  initialCaptionRevealMode,
  initialCaptionSyncOffsetSeconds,
  brandCaptionStylePresetId,
  suggestedHook,
  suggestedCaption,
  titleOptions,
  hookOptions,
  ctaOptions,
  initialHookOverlay,
  initialBrollLayer,
  initialSpeechCleanup,
  initialSpeechCleanupEdits,
  initialAudioSilenceEvents,
  initialAudioSilenceAnalyzed,
  audioSilenceReviewUrl,
  transcriptSegments,
  transcriptWords = [],
  knownDurationSeconds,
  captionQualityScore,
  captionQualityReason,
  captionWarnings,
  translationUncertainty,
  captionImprovementSuggestions,
}: ClipStudioEditorProps) {
  const {
    isDraftDirty,
    previewClock,
    requestPreviewPlayback,
    seekPreviewTo,
    seekSourcePreviewTo,
    updateEditPreview,
  } = useClipStudioPreview();
  const isPending = false;
  const historyRestorePendingRef = useRef(false);
  const lastHistorySnapshotRef = useRef<StudioDraftSnapshot | null>(null);
  const audioReviewSectionRef = useRef<HTMLDetailsElement | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [statusSuccess, setStatusSuccess] = useState(true);
  const [draftHistory, setDraftHistory] = useState<StudioDraftHistory>({ past: [], future: [] });
  const [audioSilenceReview, setAudioSilenceReview] = useState<DeferredAudioSilenceReview>(() => ({
    status: initialAudioSilenceAnalyzed
      ? "ready"
      : audioSilenceReviewUrl
        ? "idle"
        : "unavailable",
    events: initialAudioSilenceEvents,
    analyzed: initialAudioSilenceAnalyzed,
  }));

  const [startTimestamp, setStartTimestamp] = useState(
    formatSecondsForTimestampInput(initialStartTimeSeconds),
  );
  const [endTimestamp, setEndTimestamp] = useState(
    formatSecondsForTimestampInput(initialEndTimeSeconds),
  );
  const [title, setTitle] = useState(initialTitle);
  const [editorialHook, setEditorialHook] = useState(initialEditorialHook);
  const [mainCaption, setMainCaption] = useState(initialMainCaption);
  const [shortCaption, setShortCaption] = useState(initialShortCaption);
  const [platformCaption, setPlatformCaption] = useState(initialPlatformCaption);
  const [hashtags, setHashtags] = useState(() => hashtagsToEditorInput(initialHashtags));
  const [applyCaptionsToClip, setApplyCaptionsToClip] = useState(initialApplyCaptionsToClip);
  const [captionStylePresetId, setCaptionStylePresetId] = useState(initialCaptionStylePresetId);
  const [captionPosition, setCaptionPosition] = useState<CaptionPosition>(initialCaptionPosition);
  const [captionAppearance, setCaptionAppearance] = useState<CaptionAppearanceSettings>(initialCaptionAppearance);
  const [captionRevealMode, setCaptionRevealMode] = useState<CaptionRevealMode>(initialCaptionRevealMode);
  const [captionSyncOffsetSeconds, setCaptionSyncOffsetSeconds] = useState(initialCaptionSyncOffsetSeconds);
  const [captionResyncNonce, setCaptionResyncNonce] = useState(0);
  const [captionCueTextEdits, setCaptionCueTextEdits] = useState<Record<string, string>>(
    () => buildCaptionCueTextEditSeed(initialCaptionCues),
  );
  const [hookOverlay, setHookOverlay] = useState<HookOverlayConfig>(initialHookOverlay);
  const [brollLayer, setBrollLayer] = useState<BrollLayerConfig>(initialBrollLayer);
  const [speechCleanup, setSpeechCleanup] = useState<SpeechCleanupSettings>(initialSpeechCleanup);
  const [speechCleanupEdits, setSpeechCleanupEdits] = useState<SpeechCleanupEdits | null>(initialSpeechCleanupEdits);
  const initialFirstSegmentId = useMemo(
    () => findClosestTranscriptSegment(transcriptSegments, initialStartTimeSeconds, "start")?.id ?? transcriptSegments[0]?.id ?? "",
    [initialStartTimeSeconds, transcriptSegments],
  );
  const initialLastSegmentId = useMemo(
    () => findClosestTranscriptSegment(transcriptSegments, initialEndTimeSeconds, "end")?.id ?? transcriptSegments.at(-1)?.id ?? "",
    [initialEndTimeSeconds, transcriptSegments],
  );
  const [firstSegmentId, setFirstSegmentId] = useState(initialFirstSegmentId);
  const [lastSegmentId, setLastSegmentId] = useState(initialLastSegmentId);
  const [focusedSegmentId, setFocusedSegmentId] = useState(initialFirstSegmentId);
  const resolvedCaptionStyleId = captionStylePresetId || brandCaptionStylePresetId;
  const resolvedCaptionStyle = useMemo(() => resolveCaptionStylePreset(resolvedCaptionStyleId), [resolvedCaptionStyleId]);

  useEffect(() => {
    if (!audioSilenceReviewUrl || initialAudioSilenceAnalyzed) {
      return undefined;
    }

    const reviewSection = audioReviewSectionRef.current;
    if (!reviewSection) {
      return undefined;
    }

    let started = false;
    let disposed = false;
    let controller: AbortController | null = null;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

    const startDeferredReview = () => {
      if (started || disposed) {
        return;
      }

      started = true;
      controller = new AbortController();
      setAudioSilenceReview((current) => ({ ...current, status: "loading" }));

      void fetch(audioSilenceReviewUrl, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error("Audio review is unavailable.");
          }

          return response.json() as Promise<{ analyzed?: unknown; events?: unknown }>;
        })
        .then((payload) => {
          if (disposed) {
            return;
          }

          if (payload.analyzed !== true) {
            setAudioSilenceReview({ status: "unavailable", events: [], analyzed: false });
            return;
          }

          setAudioSilenceReview({
            status: "ready",
            events: sanitizeAudioSilenceReviewEvents(payload.events),
            analyzed: true,
          });
        })
        .catch((error: unknown) => {
          if (disposed || (error instanceof DOMException && error.name === "AbortError")) {
            return;
          }

          setAudioSilenceReview({ status: "unavailable", events: [], analyzed: false });
        });
    };

    let observer: IntersectionObserver | null = null;
    if ("IntersectionObserver" in window) {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            observer?.disconnect();
            startDeferredReview();
          }
        },
        { rootMargin: "320px 0px" },
      );
      observer.observe(reviewSection);
    } else {
      fallbackTimer = setTimeout(startDeferredReview, 0);
    }

    return () => {
      disposed = true;
      observer?.disconnect();
      if (fallbackTimer !== null) {
        clearTimeout(fallbackTimer);
      }
      controller?.abort();
    };
  }, [audioSilenceReviewUrl, initialAudioSilenceAnalyzed]);

  const timingPreview = useMemo(
    () =>
      validateClipStudioTiming({
        startTimestamp,
        endTimestamp,
        knownDurationSeconds,
      }),
    [startTimestamp, endTimestamp, knownDurationSeconds],
  );
  const fieldErrors: typeof timingPreview.fieldErrors & {
    captionCues?: string;
    hook?: string;
    hashtags?: string;
  } = timingPreview.fieldErrors;
  const generatedCaptionCues = useMemo(() => {
    if (timingPreview.startSeconds !== null && timingPreview.endSeconds !== null) {
      const savedTimingIsCurrent =
        Math.abs(timingPreview.startSeconds - initialStartTimeSeconds) < 0.001 &&
        Math.abs(timingPreview.endSeconds - initialEndTimeSeconds) < 0.001 &&
        captionRevealMode === initialCaptionRevealMode &&
        captionResyncNonce === 0;
      if (savedTimingIsCurrent && initialCaptionCues.length > 0) {
        return initialCaptionCues;
      }

      const timedWordCues = transcriptWords.length > 0
        ? buildTimedCaptionCuesFromTranscriptWords({
            startTimeSeconds: timingPreview.startSeconds,
            endTimeSeconds: timingPreview.endSeconds,
            words: transcriptWords,
            maxWordsPerCue: captionRevealMode === "single-word" ? 1 : 5,
            maxCueDurationSeconds: captionRevealMode === "single-word" ? 1.4 : 2.4,
          })
        : [];
      const transcriptCues = timedWordCues.length > 0
        ? timedWordCues
        : captionRevealMode === "single-word"
          ? buildTimedCaptionCuesFromTranscriptSegments({
              startTimeSeconds: timingPreview.startSeconds,
              endTimeSeconds: timingPreview.endSeconds,
              segments: transcriptSegments,
            })
          : buildEditableCaptionCuesFromTranscriptSegments({
        startTimeSeconds: timingPreview.startSeconds,
        endTimeSeconds: timingPreview.endSeconds,
        segments: transcriptSegments,
            });

      if (transcriptCues.length > 0) {
        return transcriptCues;
      }
    }

    return initialCaptionCues;
  }, [
    captionResyncNonce,
    captionRevealMode,
    initialCaptionCues,
    initialCaptionRevealMode,
    initialEndTimeSeconds,
    initialStartTimeSeconds,
    timingPreview.endSeconds,
    timingPreview.startSeconds,
    transcriptSegments,
    transcriptWords,
  ]);
  const captionCues = useMemo(
    () =>
      generatedCaptionCues.map((cue, index) => ({
        ...cue,
        index: index + 1,
        text: captionCueTextEdits[getCaptionCueKey(cue)] ?? cue.text,
      })),
    [captionCueTextEdits, generatedCaptionCues],
  );
  const onVideoCaptionText = captionCues.map((cue) => cue.text.trim()).filter(Boolean).join(" ");
  const captionLineLabel = captionRevealMode === "single-word"
    ? `${captionCues.length} ${captionCues.length === 1 ? "word pop" : "word pops"}`
    : `${captionCues.length} ${captionCues.length === 1 ? "line" : "lines"}`;
  const captionDropdownPreview = onVideoCaptionText || "No on-video caption text yet.";

  const durationLabel =
    timingPreview.durationSeconds !== null
      ? formatSecondsForPastorView(Math.max(0, timingPreview.durationSeconds))
      : "—";
  const timingGuidance = getTimingGuidance(timingPreview.durationSeconds);

  const sliderStartSeconds =
    timingPreview.startSeconds !== null ? timingPreview.startSeconds : initialStartTimeSeconds;
  const sliderEndSeconds =
    timingPreview.endSeconds !== null ? timingPreview.endSeconds : initialEndTimeSeconds;

  const localTimeline = useMemo(() => {
    const transcriptStart = transcriptSegments[0]?.startTimeSeconds ?? initialStartTimeSeconds;
    const transcriptEnd = transcriptSegments.at(-1)?.endTimeSeconds ?? initialEndTimeSeconds;
    const selectedStart = timingPreview.startSeconds ?? initialStartTimeSeconds;
    const selectedEnd = timingPreview.endSeconds ?? initialEndTimeSeconds;
    const paddingSeconds = Math.max(8, Math.min(20, ((selectedEnd - selectedStart) || 60) * 0.18));
    const hardStart = 0;
    const hardEnd = knownDurationSeconds && knownDurationSeconds > 0
      ? knownDurationSeconds
      : Math.max(transcriptEnd, selectedEnd, initialEndTimeSeconds);
    const visibleStart = clampSeconds(Math.min(transcriptStart, selectedStart) - paddingSeconds, hardStart, hardEnd);
    const visibleEnd = clampSeconds(Math.max(transcriptEnd, selectedEnd) + paddingSeconds, visibleStart + 1, hardEnd);

    return {
      start: visibleStart,
      end: visibleEnd,
      duration: Math.max(1, visibleEnd - visibleStart),
    };
  }, [
    initialEndTimeSeconds,
    initialStartTimeSeconds,
    knownDurationSeconds,
    timingPreview.endSeconds,
    timingPreview.startSeconds,
    transcriptSegments,
  ]);

  const trimTrack = useMemo(() => {
    if (timingPreview.startSeconds === null || timingPreview.endSeconds === null) {
      return null;
    }

    const start = clampSeconds(timingPreview.startSeconds, localTimeline.start, localTimeline.end);
    const end = clampSeconds(timingPreview.endSeconds, start, localTimeline.end);
    const startPercent = ((start - localTimeline.start) / localTimeline.duration) * 100;
    const endPercent = ((end - localTimeline.start) / localTimeline.duration) * 100;

    return {
      start,
      end,
      visibleStart: localTimeline.start,
      visibleEnd: localTimeline.end,
      startPercent,
      widthPercent: Math.max(0.8, endPercent - startPercent),
    };
  }, [localTimeline, timingPreview.endSeconds, timingPreview.startSeconds]);

  const playhead = useMemo(() => {
    if (timingPreview.startSeconds === null) {
      return null;
    }

    const absoluteSeconds = timingPreview.startSeconds + previewClock.sourceCurrentSeconds;
    if (absoluteSeconds < localTimeline.start || absoluteSeconds > localTimeline.end) {
      return null;
    }

    return {
      absoluteSeconds,
      percent: clampSeconds(((absoluteSeconds - localTimeline.start) / localTimeline.duration) * 100, 0, 100),
      label: formatSecondsForPastorView(absoluteSeconds),
    };
  }, [localTimeline.duration, localTimeline.end, localTimeline.start, previewClock.sourceCurrentSeconds, timingPreview.startSeconds]);
  const audioSilenceMatchesCurrentTiming =
    timingPreview.startSeconds !== null &&
    timingPreview.endSeconds !== null &&
    Math.abs(timingPreview.startSeconds - initialStartTimeSeconds) < 0.05 &&
    Math.abs(timingPreview.endSeconds - initialEndTimeSeconds) < 0.05;
  const activeAudioSilenceEvents = audioSilenceMatchesCurrentTiming
    ? audioSilenceReview.events
    : EMPTY_AUDIO_SILENCE_EVENTS;
  const activeAudioSilenceAnalyzed = audioSilenceMatchesCurrentTiming ? audioSilenceReview.analyzed : false;
  const audioSilenceReviewMessage = !audioSilenceMatchesCurrentTiming
    ? "Exact pause markers apply to the saved timing. Save or reset these boundaries to check the revised clip."
    : audioSilenceReview.status === "loading"
      ? "Checking the source audio for exact silent sections. You can keep editing while this runs."
      : audioSilenceReview.status === "ready"
        ? audioSilenceReview.events.length > 0
          ? `Source audio checked · ${audioSilenceReview.events.length} confirmed silent section${audioSilenceReview.events.length === 1 ? "" : "s"}.`
          : "Source audio checked. No confirmed silent sections were found."
        : audioSilenceReview.status === "idle"
          ? "Exact pause analysis will begin when the Audio workspace comes into view."
          : "Exact audio analysis is unavailable right now. Transcript timing remains active, and final preparation keeps its normal media checks.";
  const speechCleanupPreviewPlan = useMemo(
    () =>
      buildSpeechCleanupPreviewPlan({
        captionCues,
        durationSeconds: timingPreview.durationSeconds,
        speechCleanup,
        audioSilenceEvents: activeAudioSilenceEvents,
        audioSilenceAnalysisAvailable: activeAudioSilenceAnalyzed,
        speechCleanupEdits,
      }),
    [
      activeAudioSilenceAnalyzed,
      activeAudioSilenceEvents,
      captionCues,
      speechCleanup,
      speechCleanupEdits,
      timingPreview.durationSeconds,
    ],
  );
  const deadAirCutMarkers = useMemo(() => {
    if (!speechCleanupPreviewPlan.enabled || timingPreview.startSeconds === null) {
      return [];
    }

    const selectedStartSeconds = timingPreview.startSeconds;
    return speechCleanupPreviewPlan.reviewItems.flatMap((range) => {
      const absoluteStart = selectedStartSeconds + range.startSeconds;
      const absoluteEnd = selectedStartSeconds + range.endSeconds;
      if (absoluteEnd < localTimeline.start || absoluteStart > localTimeline.end) {
        return [];
      }

      const leftPercent = clampSeconds(((absoluteStart - localTimeline.start) / localTimeline.duration) * 100, 0, 100);
      const rightPercent = clampSeconds(((absoluteEnd - localTimeline.start) / localTimeline.duration) * 100, 0, 100);
      return [{
        id: range.id,
        leftPercent,
        widthPercent: Math.max(0.6, rightPercent - leftPercent),
        label: range.label,
        title: range.source === "audio"
          ? `${range.label}: ${formatCleanupDuration(range.removedSeconds)} audio silence`
          : `${range.label}: ${formatCleanupDuration(range.removedSeconds)} estimated pause`,
        source: range.source,
      }];
    });
  }, [localTimeline.duration, localTimeline.end, localTimeline.start, speechCleanupPreviewPlan, timingPreview.startSeconds]);
  const aiBoundaryMarkers = useMemo(
    () =>
      [
        { id: "ai-start", seconds: initialStartTimeSeconds, label: "AI start" },
        { id: "ai-end", seconds: initialEndTimeSeconds, label: "AI end" },
      ].flatMap((marker) => {
        if (marker.seconds < localTimeline.start || marker.seconds > localTimeline.end) {
          return [];
        }

        return [{
          ...marker,
          percent: clampSeconds(((marker.seconds - localTimeline.start) / localTimeline.duration) * 100, 0, 100),
        }];
      }),
    [initialEndTimeSeconds, initialStartTimeSeconds, localTimeline.duration, localTimeline.end, localTimeline.start],
  );

  const transcriptClipBlocks = useMemo(
    () =>
      transcriptSegments.map((segment, index) => {
        const startsInside = segment.startTimeSeconds >= sliderStartSeconds && segment.startTimeSeconds < sliderEndSeconds;
        const endsInside = segment.endTimeSeconds > sliderStartSeconds && segment.endTimeSeconds <= sliderEndSeconds;
        const spansSelection = segment.startTimeSeconds <= sliderStartSeconds && segment.endTimeSeconds >= sliderEndSeconds;
        const isSelected = startsInside || endsInside || spansSelection;
        const leftPercent = clampSeconds(
          ((segment.startTimeSeconds - localTimeline.start) / localTimeline.duration) * 100,
          0,
          100,
        );
        const rightPercent = clampSeconds(
          ((segment.endTimeSeconds - localTimeline.start) / localTimeline.duration) * 100,
          0,
          100,
        );

        return {
          ...segment,
          index,
          isSelected,
          leftPercent,
          widthPercent: Math.max(0.65, rightPercent - leftPercent),
        };
      }),
    [localTimeline.duration, localTimeline.start, sliderEndSeconds, sliderStartSeconds, transcriptSegments],
  );
  const focusedSegment = useMemo(
    () => transcriptSegments.find((segment) => segment.id === focusedSegmentId) ?? null,
    [focusedSegmentId, transcriptSegments],
  );
  const activeBoundarySegments = useMemo(() => {
    if (timingPreview.startSeconds === null || timingPreview.endSeconds === null) {
      return {
        first: null,
        last: null,
        count: 0,
      };
    }

    const overlappingSegments = transcriptSegments.filter(
      (segment) =>
        segment.endTimeSeconds > (timingPreview.startSeconds ?? 0) &&
        segment.startTimeSeconds < (timingPreview.endSeconds ?? 0),
    );

    return {
      first: findClosestTranscriptSegment(transcriptSegments, timingPreview.startSeconds, "start"),
      last: findClosestTranscriptSegment(transcriptSegments, timingPreview.endSeconds, "end"),
      count: overlappingSegments.length,
    };
  }, [timingPreview.endSeconds, timingPreview.startSeconds, transcriptSegments]);
  const currentDraftSnapshot = useMemo<StudioDraftSnapshot>(
    () => ({
      startTimestamp,
      endTimestamp,
      title,
      editorialHook,
      mainCaption,
      shortCaption,
      platformCaption,
      hashtags,
      applyCaptionsToClip,
      captionStylePresetId,
      captionPosition,
      captionAppearance,
      captionRevealMode,
      captionSyncOffsetSeconds,
      captionCueTextEdits,
      hookOverlay,
      brollLayer,
      speechCleanup,
      speechCleanupEdits,
      firstSegmentId,
      lastSegmentId,
      focusedSegmentId,
    }),
    [
      applyCaptionsToClip,
      brollLayer,
      captionAppearance,
      captionRevealMode,
      captionSyncOffsetSeconds,
      captionCueTextEdits,
      captionPosition,
      captionStylePresetId,
      endTimestamp,
      editorialHook,
      firstSegmentId,
      focusedSegmentId,
      hashtags,
      hookOverlay,
      lastSegmentId,
      mainCaption,
      platformCaption,
      shortCaption,
      speechCleanup,
      speechCleanupEdits,
      startTimestamp,
      title,
    ],
  );

  const editPreview = useMemo(
    () => ({
      startLabel:
        timingPreview.startSeconds !== null
          ? formatSecondsForPastorView(timingPreview.startSeconds)
          : startTimestamp.trim() || "Invalid start",
      endLabel:
        timingPreview.endSeconds !== null
          ? formatSecondsForPastorView(timingPreview.endSeconds)
          : endTimestamp.trim() || "Invalid end",
      durationLabel,
      startSeconds: timingPreview.startSeconds,
      endSeconds: timingPreview.endSeconds,
      durationSeconds: timingPreview.durationSeconds,
      title,
      editorialHook,
      mainCaption,
      shortCaption,
      platformCaption,
      onVideoCaptionText,
      captionCues,
      applyCaptionsToClip,
      captionStylePresetId: resolvedCaptionStyle.id,
      captionPosition,
      captionAppearance,
      captionRevealMode,
      captionSyncOffsetSeconds,
      hookOverlay,
      brollLayer,
      speechCleanup,
      speechCleanupEdits,
      audioSilenceEvents: activeAudioSilenceEvents,
      audioSilenceAnalyzed: activeAudioSilenceAnalyzed,
      hashtags,
      isTimingValid: timingPreview.isValid,
    }),
    [
      activeAudioSilenceAnalyzed,
      activeAudioSilenceEvents,
      durationLabel,
      endTimestamp,
      captionCues,
      editorialHook,
      hashtags,
      mainCaption,
      onVideoCaptionText,
      applyCaptionsToClip,
      captionAppearance,
      captionRevealMode,
      captionSyncOffsetSeconds,
      captionPosition,
      platformCaption,
      resolvedCaptionStyle.id,
      shortCaption,
      startTimestamp,
      title,
      hookOverlay,
      brollLayer,
      speechCleanup,
      speechCleanupEdits,
      timingPreview.durationSeconds,
      timingPreview.endSeconds,
      timingPreview.isValid,
      timingPreview.startSeconds,
    ],
  );

  useEffect(() => {
    updateEditPreview(editPreview);
  }, [editPreview, updateEditPreview]);

  useEffect(() => {
    const nextSnapshot = cloneStudioDraftSnapshot(currentDraftSnapshot);
    const nextSnapshotKey = getStudioDraftSnapshotKey(nextSnapshot);
    const previousSnapshot = lastHistorySnapshotRef.current;

    if (!previousSnapshot) {
      lastHistorySnapshotRef.current = nextSnapshot;
      return;
    }

    if (historyRestorePendingRef.current) {
      historyRestorePendingRef.current = false;
      lastHistorySnapshotRef.current = nextSnapshot;
      return;
    }

    if (getStudioDraftSnapshotKey(previousSnapshot) === nextSnapshotKey) {
      return;
    }

    setDraftHistory((current) => ({
      past: [...current.past, cloneStudioDraftSnapshot(previousSnapshot)].slice(-60),
      future: [],
    }));
    lastHistorySnapshotRef.current = nextSnapshot;
  }, [currentDraftSnapshot]);

  useEffect(() => {
    function handleTimelineDurationRequest(event: Event) {
      const detail = (event as CustomEvent<{ lengthSeconds?: unknown }>).detail;
      const targetDurationSeconds = Number(detail?.lengthSeconds);

      if (!Number.isFinite(targetDurationSeconds) || targetDurationSeconds <= 0) {
        return;
      }

      clearFeedback();

      const currentStart = timingPreview.startSeconds ?? initialStartTimeSeconds;
      const hardEnd = knownDurationSeconds && knownDurationSeconds > 0
        ? knownDurationSeconds
        : Math.max(localTimeline.end, currentStart + targetDurationSeconds);
      const nextEnd = clampSeconds(currentStart + targetDurationSeconds, currentStart + 0.1, hardEnd);
      const lastSegment = findClosestTranscriptSegment(transcriptSegments, nextEnd, "end");

      setEndTimestamp(formatSecondsForTimestampInput(nextEnd));
      if (lastSegment) {
        setLastSegmentId(lastSegment.id);
      }
      seekPreviewTo(0);
      setStatusSuccess(true);
      setStatusMessage(`${targetDurationSeconds}s clip length drafted from the timeline.`);
    }

    window.addEventListener("clip-studio-set-duration", handleTimelineDurationRequest);
    return () => window.removeEventListener("clip-studio-set-duration", handleTimelineDurationRequest);
  }, [
    initialStartTimeSeconds,
    knownDurationSeconds,
    localTimeline.end,
    seekPreviewTo,
    timingPreview.startSeconds,
    transcriptSegments,
  ]);

  function clearFeedback() {
    setStatusMessage("");
  }

  function restoreDraftSnapshot(snapshot: StudioDraftSnapshot, message: string) {
    const nextSnapshot = cloneStudioDraftSnapshot(snapshot);
    historyRestorePendingRef.current = true;
    setStartTimestamp(nextSnapshot.startTimestamp);
    setEndTimestamp(nextSnapshot.endTimestamp);
    setTitle(nextSnapshot.title);
    setEditorialHook(nextSnapshot.editorialHook);
    setMainCaption(nextSnapshot.mainCaption);
    setShortCaption(nextSnapshot.shortCaption);
    setPlatformCaption(nextSnapshot.platformCaption);
    setHashtags(nextSnapshot.hashtags);
    setApplyCaptionsToClip(nextSnapshot.applyCaptionsToClip);
    setCaptionStylePresetId(nextSnapshot.captionStylePresetId);
    setCaptionPosition(nextSnapshot.captionPosition);
    setCaptionAppearance(nextSnapshot.captionAppearance);
    setCaptionRevealMode(nextSnapshot.captionRevealMode);
    setCaptionSyncOffsetSeconds(nextSnapshot.captionSyncOffsetSeconds);
    setCaptionCueTextEdits(nextSnapshot.captionCueTextEdits);
    setHookOverlay(nextSnapshot.hookOverlay);
    setBrollLayer(nextSnapshot.brollLayer);
    setSpeechCleanup(nextSnapshot.speechCleanup);
    setSpeechCleanupEdits(nextSnapshot.speechCleanupEdits);
    setFirstSegmentId(nextSnapshot.firstSegmentId);
    setLastSegmentId(nextSnapshot.lastSegmentId);
    setFocusedSegmentId(nextSnapshot.focusedSegmentId);
    setStatusSuccess(true);
    setStatusMessage(message);
  }

  function undoDraftChange() {
    const previousSnapshot = draftHistory.past.at(-1);
    if (!previousSnapshot) {
      return;
    }

    const currentSnapshot = cloneStudioDraftSnapshot(currentDraftSnapshot);
    setDraftHistory((current) => ({
      past: current.past.slice(0, -1),
      future: [currentSnapshot, ...current.future].slice(0, 60),
    }));
    restoreDraftSnapshot(previousSnapshot, "Draft change undone.");
  }

  function redoDraftChange() {
    const nextSnapshot = draftHistory.future[0];
    if (!nextSnapshot) {
      return;
    }

    const currentSnapshot = cloneStudioDraftSnapshot(currentDraftSnapshot);
    setDraftHistory((current) => ({
      past: [...current.past, currentSnapshot].slice(-60),
      future: current.future.slice(1),
    }));
    restoreDraftSnapshot(nextSnapshot, "Draft change restored.");
  }

  function applyTranscriptTrim() {
    const firstSegment = transcriptSegments.find((segment) => segment.id === firstSegmentId);
    const lastSegment = transcriptSegments.find((segment) => segment.id === lastSegmentId);

    if (!firstSegment || !lastSegment) {
      setStatusSuccess(false);
      setStatusMessage("Choose the first and last spoken lines for this clip.");
      return;
    }

    if (lastSegment.endTimeSeconds <= firstSegment.startTimeSeconds) {
      setStatusSuccess(false);
      setStatusMessage("The last spoken line must come after the first spoken line.");
      return;
    }

    setStartTimestamp(formatSecondsForTimestampInput(firstSegment.startTimeSeconds));
    setEndTimestamp(formatSecondsForTimestampInput(lastSegment.endTimeSeconds));
    setStatusSuccess(true);
    setStatusMessage("Trim updated from transcript text. Preview updated.");
  }

  function applyBoundaryFromSegment(segment: TranscriptSegmentOption, boundary: "start" | "end") {
    clearFeedback();

    if (boundary === "start") {
      const currentEnd = timingPreview.endSeconds ?? initialEndTimeSeconds;
      const nextStart = Math.min(segment.startTimeSeconds, Math.max(0, currentEnd - 0.1));
      setStartTimestamp(formatSecondsForTimestampInput(nextStart));
      setFirstSegmentId(segment.id);
      setStatusMessage("Start point set from the selected spoken line.");
      setStatusSuccess(true);
      return;
    }

    const currentStart = timingPreview.startSeconds ?? initialStartTimeSeconds;
    const hardEnd = knownDurationSeconds && knownDurationSeconds > 0 ? knownDurationSeconds : segment.endTimeSeconds;
    const nextEnd = clampSeconds(segment.endTimeSeconds, currentStart + 0.1, hardEnd);
    setEndTimestamp(formatSecondsForTimestampInput(nextEnd));
    setLastSegmentId(segment.id);
    setStatusMessage("End point set from the selected spoken line.");
    setStatusSuccess(true);
  }

  function seekPreviewToAbsolute(absoluteSeconds: number) {
    if (timingPreview.startSeconds === null) {
      return;
    }

    seekSourcePreviewTo(Math.max(0, absoluteSeconds - timingPreview.startSeconds));
  }

  function onTimelineClick(event: MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) {
      return;
    }

    const clickPercent = clampSeconds((event.clientX - rect.left) / rect.width, 0, 1);
    const absoluteSeconds = localTimeline.start + clickPercent * localTimeline.duration;
    const nearestSegment = findClosestTranscriptSegment(transcriptSegments, absoluteSeconds, "start");
    if (nearestSegment) {
      setFocusedSegmentId(nearestSegment.id);
    }

    seekPreviewToAbsolute(absoluteSeconds);
  }

  function buildClipAroundSegment(segment: TranscriptSegmentOption, targetDurationSeconds: number) {
    clearFeedback();

    const hardEnd = knownDurationSeconds && knownDurationSeconds > 0
      ? knownDurationSeconds
      : Math.max(segment.endTimeSeconds, localTimeline.end);
    const segmentCenter = segment.startTimeSeconds + ((segment.endTimeSeconds - segment.startTimeSeconds) / 2);
    const halfDuration = targetDurationSeconds / 2;
    let nextStart = segmentCenter - halfDuration;
    let nextEnd = segmentCenter + halfDuration;

    if (nextStart < 0) {
      nextEnd += Math.abs(nextStart);
      nextStart = 0;
    }

    if (nextEnd > hardEnd) {
      nextStart = Math.max(0, nextStart - (nextEnd - hardEnd));
      nextEnd = hardEnd;
    }

    const firstSegment = findClosestTranscriptSegment(transcriptSegments, nextStart, "start");
    const lastSegment = findClosestTranscriptSegment(transcriptSegments, nextEnd, "end");

    setStartTimestamp(formatSecondsForTimestampInput(firstSegment?.startTimeSeconds ?? nextStart));
    setEndTimestamp(formatSecondsForTimestampInput(nextEnd));
    setFirstSegmentId(firstSegment?.id ?? segment.id);
    setLastSegmentId(lastSegment?.id ?? segment.id);
    setStatusSuccess(true);
    setStatusMessage(`${targetDurationSeconds}s draft built around the selected spoken line. Preview updated.`);
  }

  function setDurationFromCurrentStart(targetDurationSeconds: number) {
    clearFeedback();

    const currentStart = timingPreview.startSeconds ?? initialStartTimeSeconds;
    const hardEnd = knownDurationSeconds && knownDurationSeconds > 0
      ? knownDurationSeconds
      : Math.max(localTimeline.end, currentStart + targetDurationSeconds);
    const nextEnd = clampSeconds(currentStart + targetDurationSeconds, currentStart + 0.1, hardEnd);
    const lastSegment = findClosestTranscriptSegment(transcriptSegments, nextEnd, "end");

    setEndTimestamp(formatSecondsForTimestampInput(lastSegment?.endTimeSeconds ?? nextEnd));
    if (lastSegment) {
      setLastSegmentId(lastSegment.id);
    }
    seekPreviewTo(0);
    setStatusSuccess(true);
    setStatusMessage(`${targetDurationSeconds}s clip length drafted from the current start.`);
  }

  function resetTiming() {
    clearFeedback();
    setStartTimestamp(formatSecondsForTimestampInput(initialStartTimeSeconds));
    setEndTimestamp(formatSecondsForTimestampInput(initialEndTimeSeconds));
    setFirstSegmentId(initialFirstSegmentId);
    setLastSegmentId(initialLastSegmentId);
    setFocusedSegmentId(initialFirstSegmentId);
    setStatusSuccess(true);
    setStatusMessage("Timing reset to the AI suggestion.");
  }

  function snapToNearestSpokenLines() {
    if (timingPreview.startSeconds === null || timingPreview.endSeconds === null) {
      setStatusSuccess(false);
      setStatusMessage("Enter valid start and end times before snapping to spoken lines.");
      return;
    }

    const firstSegment = findClosestTranscriptSegment(transcriptSegments, timingPreview.startSeconds, "start");
    const lastSegment = findClosestTranscriptSegment(transcriptSegments, timingPreview.endSeconds, "end");
    if (!firstSegment || !lastSegment || lastSegment.endTimeSeconds <= firstSegment.startTimeSeconds) {
      setStatusSuccess(false);
      setStatusMessage("Could not find clean transcript boundaries near this timing.");
      return;
    }

    setFirstSegmentId(firstSegment.id);
    setLastSegmentId(lastSegment.id);
    setStartTimestamp(formatSecondsForTimestampInput(firstSegment.startTimeSeconds));
    setEndTimestamp(formatSecondsForTimestampInput(lastSegment.endTimeSeconds));
    setStatusSuccess(true);
    setStatusMessage("Timing snapped to the nearest spoken lines. Preview updated.");
  }

  function nudgeBoundary(boundary: "start" | "end", deltaSeconds: number) {
    const currentStart = timingPreview.startSeconds ?? initialStartTimeSeconds;
    const currentEnd = timingPreview.endSeconds ?? initialEndTimeSeconds;
    const maxKnownEnd = knownDurationSeconds ?? Number.POSITIVE_INFINITY;

    if (boundary === "start") {
      const maxStart = Math.max(0, currentEnd - 0.1);
      const nextStart = Math.max(0, Math.min(maxStart, currentStart + deltaSeconds));
      setStartTimestamp(formatSecondsForTimestampInput(nextStart));
      return;
    }

    const minEnd = Math.max(0.1, currentStart + 0.1);
    const nextEnd = Math.max(minEnd, Math.min(maxKnownEnd, currentEnd + deltaSeconds));
    setEndTimestamp(formatSecondsForTimestampInput(nextEnd));
  }

  function onStartSliderChange(rawValue: number) {
    const maxStart = Math.max(0, sliderEndSeconds - 0.1);
    const nextStart = clampSeconds(rawValue, localTimeline.start, Math.min(localTimeline.end, maxStart));
    setStartTimestamp(formatSecondsForTimestampInput(nextStart));
  }

  function onEndSliderChange(rawValue: number) {
    const minEnd = Math.min(localTimeline.end, sliderStartSeconds + 0.1);
    const nextEnd = clampSeconds(rawValue, minEnd, localTimeline.end);
    setEndTimestamp(formatSecondsForTimestampInput(nextEnd));
  }

  function applyBoundaryFromAbsoluteSeconds(rawSeconds: number, boundary: "start" | "end") {
    if (!Number.isFinite(rawSeconds)) {
      return;
    }

    clearFeedback();

    if (boundary === "start") {
      const currentEnd = timingPreview.endSeconds ?? initialEndTimeSeconds;
      const nextStart = clampSeconds(rawSeconds, 0, Math.max(0, currentEnd - 0.1));
      const firstSegment = findClosestTranscriptSegment(transcriptSegments, nextStart, "start");
      setStartTimestamp(formatSecondsForTimestampInput(nextStart));
      if (firstSegment) {
        setFirstSegmentId(firstSegment.id);
        setFocusedSegmentId(firstSegment.id);
      }
      seekPreviewTo(0);
      setStatusSuccess(true);
      setStatusMessage("Start point set from the timeline.");
      return;
    }

    const currentStart = timingPreview.startSeconds ?? initialStartTimeSeconds;
    const hardEnd = knownDurationSeconds && knownDurationSeconds > 0
      ? knownDurationSeconds
      : Math.max(localTimeline.end, rawSeconds);
    const nextEnd = clampSeconds(rawSeconds, currentStart + 0.1, hardEnd);
    const lastSegment = findClosestTranscriptSegment(transcriptSegments, nextEnd, "end");
    setEndTimestamp(formatSecondsForTimestampInput(nextEnd));
    if (lastSegment) {
      setLastSegmentId(lastSegment.id);
      setFocusedSegmentId(lastSegment.id);
    }
    seekSourcePreviewTo(Math.max(0, nextEnd - currentStart));
    setStatusSuccess(true);
    setStatusMessage("End point set from the timeline.");
  }

  function updateCaptionCueText(cue: EditableCaptionCue, text: string) {
    const cueKey = getCaptionCueKey(cue);
    setCaptionCueTextEdits((current) => ({
      ...current,
      [cueKey]: text,
    }));
  }

  function changeCaptionRevealMode(nextMode: CaptionRevealMode) {
    if (nextMode === captionRevealMode) {
      return;
    }

    setCaptionRevealMode(nextMode);
    setCaptionResyncNonce((current) => current + 1);
    setStatusSuccess(true);
    setStatusMessage(
      nextMode === "single-word"
        ? "One-word pop captions synced from the spoken transcript."
        : nextMode === "active-word"
          ? "Active-word captions synced from the spoken transcript."
          : "Phrase captions synced from the spoken transcript.",
    );
  }

  function resyncCaptionsFromSpeech() {
    setCaptionCueTextEdits({});
    setCaptionSyncOffsetSeconds(0);
    setCaptionResyncNonce((current) => current + 1);
    setStatusSuccess(true);
    setStatusMessage("Caption timing re-synced from the spoken transcript and the timing offset reset.");
  }

  function setCaptionSyncOffset(nextSeconds: number) {
    setCaptionSyncOffsetSeconds(normalizeCaptionSyncOffsetSeconds(nextSeconds));
  }

  function resetCaptionCueText(cue: EditableCaptionCue) {
    const cueKey = getCaptionCueKey(cue);
    setCaptionCueTextEdits((current) => {
      const next = { ...current };
      delete next[cueKey];
      return next;
    });
  }

  function isCaptionCueTextEdited(cue: EditableCaptionCue): boolean {
    const editedText = captionCueTextEdits[getCaptionCueKey(cue)];
    const sourceCue = generatedCaptionCues.find((item) => getCaptionCueKey(item) === getCaptionCueKey(cue));
    return editedText !== undefined && editedText !== sourceCue?.text;
  }

  function findCaptionCueForTranscriptSegment(segment: TranscriptSegmentOption): EditableCaptionCue | null {
    if (timingPreview.startSeconds === null || timingPreview.endSeconds === null) {
      return null;
    }

    const overlapStart = Math.max(timingPreview.startSeconds, segment.startTimeSeconds);
    const overlapEnd = Math.min(timingPreview.endSeconds, segment.endTimeSeconds);
    if (overlapEnd <= overlapStart) {
      return null;
    }

    const relativeStart = Number((overlapStart - timingPreview.startSeconds).toFixed(3));
    const relativeEnd = Number((overlapEnd - timingPreview.startSeconds).toFixed(3));

    return (
      generatedCaptionCues.find(
        (cue) =>
          Math.abs(cue.startSeconds - relativeStart) < 0.08 &&
          Math.abs(cue.endSeconds - relativeEnd) < 0.08,
      ) ?? null
    );
  }

  useEffect(() => {
    function handleTranscriptCommand(event: Event) {
      const detail = (event as CustomEvent<ClipStudioTranscriptCommandDetail>).detail;
      if (!detail || typeof detail.command !== "string") {
        return;
      }

      if (detail.command === "snap-to-sentence") {
        snapToNearestSpokenLines();
        return;
      }

      if (detail.command === "reset-ai") {
        resetTiming();
        return;
      }

      if (detail.command === "set-start-seconds") {
        applyBoundaryFromAbsoluteSeconds(Number(detail.seconds), "start");
        return;
      }

      if (detail.command === "set-end-seconds") {
        applyBoundaryFromAbsoluteSeconds(Number(detail.seconds), "end");
        return;
      }

      if (!detail.segmentId) {
        return;
      }

      const segment = transcriptSegments.find((item) => item.id === detail.segmentId);
      if (!segment) {
        return;
      }

      setFocusedSegmentId(segment.id);

      if (detail.command === "update-text") {
        const cue = findCaptionCueForTranscriptSegment(segment);
        if (cue) {
          updateCaptionCueText(cue, typeof detail.text === "string" ? detail.text : segment.text);
        }
        return;
      }

      if (detail.command === "reset-text") {
        const cue = findCaptionCueForTranscriptSegment(segment);
        if (cue) {
          resetCaptionCueText(cue);
        }
        return;
      }

      if (detail.command === "set-start") {
        applyBoundaryFromSegment(segment, "start");
        seekPreviewTo(0);
        return;
      }

      if (detail.command === "set-end") {
        applyBoundaryFromSegment(segment, "end");
        seekPreviewToAbsolute(segment.startTimeSeconds);
      }
    }

    window.addEventListener(CLIP_STUDIO_TRANSCRIPT_COMMAND_EVENT, handleTranscriptCommand);
    return () => window.removeEventListener(CLIP_STUDIO_TRANSCRIPT_COMMAND_EVENT, handleTranscriptCommand);
  });

  useEffect(() => {
    function handleSpeechCleanupEdit(event: Event) {
      const detail = (event as CustomEvent<ClipStudioSpeechCleanupEditDetail>).detail;
      if (!detail || typeof detail.command !== "string") {
        return;
      }

      if (detail.command === "reset-cuts") {
        setSpeechCleanupEdits(null);
        return;
      }

      if (detail.command === "add-cut") {
        const startSeconds = Number(detail.startSeconds);
        const endSeconds = Number(detail.endSeconds);
        if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || endSeconds - startSeconds < 0.2) {
          return;
        }

        setSpeechCleanupEdits((current) => {
          const seed = current ?? createSpeechCleanupEditsFromPlan(speechCleanupPreviewPlan);
          const roundedStart = Number(startSeconds.toFixed(3));
          const roundedEnd = Number(endSeconds.toFixed(3));
          const removedSeconds = Number((roundedEnd - roundedStart).toFixed(3));
          const cut = {
            id: `manual-internal-${roundedStart}-${roundedEnd}-${Date.now()}`,
            kind: "internal" as const,
            source: "audio" as const,
            confidence: "confirmed" as const,
            startSeconds: roundedStart,
            endSeconds: roundedEnd,
            removedSeconds,
            rawGapSeconds: removedSeconds,
            beforeText: null,
            afterText: null,
            enabled: true,
          };

          return {
            version: 1,
            cuts: [...seed.cuts, cut].sort((left, right) => left.startSeconds - right.startSeconds),
            updatedAt: new Date().toISOString(),
          };
        });
        return;
      }

      if (detail.command === "set-all-cuts") {
        setSpeechCleanupEdits((current) => {
          const seed = current ?? createSpeechCleanupEditsFromPlan(speechCleanupPreviewPlan);
          return {
            version: 1,
            cuts: seed.cuts.map((cut) => ({ ...cut, enabled: detail.enabled !== false })),
            updatedAt: new Date().toISOString(),
          };
        });
        return;
      }

      if (!detail.cutId) {
        return;
      }

      setSpeechCleanupEdits((current) => {
        const seed = current ?? createSpeechCleanupEditsFromPlan(speechCleanupPreviewPlan);
        const updatedAt = new Date().toISOString();

        if (detail.command === "toggle-cut") {
          return {
            version: 1,
            cuts: seed.cuts.map((cut) => cut.id === detail.cutId ? { ...cut, enabled: !cut.enabled } : cut),
            updatedAt,
          };
        }

        if (detail.command === "delete-cut") {
          return {
            version: 1,
            cuts: seed.cuts.filter((cut) => cut.id !== detail.cutId),
            updatedAt,
          };
        }

        if (detail.command === "update-cut") {
          const startSeconds = Number(detail.startSeconds);
          const endSeconds = Number(detail.endSeconds);
          if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || endSeconds - startSeconds < 0.2) {
            return seed;
          }

          return {
            version: 1,
            cuts: seed.cuts
              .map((cut) =>
                cut.id === detail.cutId
                  ? {
                      ...cut,
                      startSeconds: Number(startSeconds.toFixed(3)),
                      endSeconds: Number(endSeconds.toFixed(3)),
                      removedSeconds: Number((endSeconds - startSeconds).toFixed(3)),
                      rawGapSeconds: Number((endSeconds - startSeconds).toFixed(3)),
                    }
                  : cut,
              )
              .sort((left, right) => left.startSeconds - right.startSeconds),
            updatedAt,
          };
        }

        return seed;
      });
    }

    window.addEventListener(CLIP_STUDIO_SPEECH_CLEANUP_EDIT_EVENT, handleSpeechCleanupEdit);
    return () => window.removeEventListener(CLIP_STUDIO_SPEECH_CLEANUP_EDIT_EVENT, handleSpeechCleanupEdit);
  }, [speechCleanupPreviewPlan]);

  function useSuggestedHook() {
    if (!suggestedHook.trim()) {
      return;
    }

    setHookOverlay((current) => ({
      ...current,
      enabled: true,
      text: suggestedHook,
      durationSeconds: current.durationSeconds || 6,
    }));
  }

  function useSuggestedPostHook() {
    if (!suggestedHook.trim()) {
      return;
    }

    setEditorialHook(suggestedHook.trim());
    setStatusSuccess(true);
    setStatusMessage("Suggested post opener applied. Review it before preparing.");
  }

  function useSuggestedPostCaption() {
    if (!suggestedCaption.trim()) {
      return;
    }

    setMainCaption(suggestedCaption.trim());
    setStatusSuccess(true);
    setStatusMessage("Suggested post caption applied. Review it before preparing.");
  }

  function getBrollSeedText(): string {
    return trimBrollText(
      focusedSegment?.text ||
      onVideoCaptionText ||
      hookOverlay.text ||
      suggestedHook ||
      "Key sermon moment",
      140,
    );
  }

  function addBrollCard() {
    const clipDurationSeconds = timingPreview.durationSeconds ?? 60;
    const startSeconds = resolveNextBrollCardStart({
      clipDurationSeconds,
      previewSeconds: previewClock.sourceCurrentSeconds,
      cards: brollLayer.cards,
    });
    const durationSeconds = Math.min(5, Math.max(1, clipDurationSeconds - startSeconds));
    const seedText = getBrollSeedText();
    const tone = inferBrollCardTone(seedText);
    const nextCard: BrollCardConfig = {
      id: `broll-${Date.now().toString(36)}`,
      enabled: true,
      text: seedText,
      label: focusedSegment ? "Selected line" : labelForBrollTone(tone),
      startSeconds: Number(startSeconds.toFixed(1)),
      durationSeconds: Number(durationSeconds.toFixed(1)),
      tone,
      position: "full",
    };

    setBrollLayer((current) => ({
      enabled: true,
      cards: [nextCard, ...current.cards].slice(0, 4),
    }));
    setStatusSuccess(true);
    setStatusMessage(`Visual cutaway added at ${formatSecondsForPastorView(startSeconds)}.`);
  }

  function updateBrollCard(cardId: string, updates: Partial<BrollCardConfig>) {
    setBrollLayer((current) => ({
      ...current,
      cards: current.cards.map((card) => {
        if (card.id !== cardId) {
          return card;
        }

        const clipDurationSeconds = timingPreview.durationSeconds ?? Number.POSITIVE_INFINITY;
        const startSeconds =
          typeof updates.startSeconds === "number" && Number.isFinite(updates.startSeconds)
            ? Math.max(0, Math.min(updates.startSeconds, Math.max(0, clipDurationSeconds - 0.5)))
            : card.startSeconds;
        const durationSeconds =
          typeof updates.durationSeconds === "number" && Number.isFinite(updates.durationSeconds)
            ? Math.max(1, Math.min(updates.durationSeconds, Math.max(1, clipDurationSeconds - startSeconds)))
            : card.durationSeconds;

        return {
          ...card,
          ...updates,
          text: typeof updates.text === "string" ? updates.text.slice(0, 180) : card.text,
          label: typeof updates.label === "string" ? updates.label.slice(0, 32) : card.label,
          startSeconds: Number(startSeconds.toFixed(2)),
          durationSeconds: Number(durationSeconds.toFixed(2)),
        };
      }),
    }));
  }

  function removeBrollCard(cardId: string) {
    setBrollLayer((current) => {
      const cards = current.cards.filter((card) => card.id !== cardId);
      return {
        enabled: cards.length > 0 && current.enabled,
        cards,
      };
    });
    setStatusSuccess(true);
    setStatusMessage("B-roll card removed from the preview.");
  }

  function setSpeechCleanupIntensity(intensity: SpeechCleanupIntensity) {
    setSpeechCleanup((current) => ({
      ...current,
      removeDeadAir: true,
      tightenLongPauses: true,
      intensity,
    }));
  }

  function applyCreatorReviewAction(action: CreatorReviewAction) {
    clearFeedback();

    if (action === "fix-timing") {
      if (timingPreview.durationSeconds === null || timingPreview.durationSeconds < 30 || timingPreview.durationSeconds > 120) {
        setDurationFromCurrentStart(60);
        return;
      }

      snapToNearestSpokenLines();
      return;
    }

    if (action === "enable-captions") {
      setApplyCaptionsToClip(true);
      setStatusSuccess(true);
      setStatusMessage("Captions turned on for the current draft.");
      return;
    }

    if (action === "tighten-captions") {
      setApplyCaptionsToClip(true);
      setCaptionAppearance((current) => ({
        ...current,
        fontScale: current.fontScale === "large" ? "regular" : current.fontScale,
        maxLines: Math.min(current.maxLines, 3) as CaptionMaxLines,
      }));
      setStatusSuccess(true);
      setStatusMessage("Caption layout tightened for the preview.");
      return;
    }

    if (action === "add-hook") {
      const fallbackHook = onVideoCaptionText.split(/\s+/).filter(Boolean).slice(0, 9).join(" ");
      setHookOverlay((current) => ({
        ...current,
        enabled: true,
        text: current.text.trim() || suggestedHook.trim() || fallbackHook,
        durationSeconds: current.durationSeconds || 6,
      }));
      setStatusSuccess(true);
      setStatusMessage("Hook overlay added to the opening seconds.");
      return;
    }

    if (action === "fix-hook-timing") {
      if (hookOverlayVisibility.error) {
        setStatusSuccess(false);
        setStatusMessage(hookOverlayVisibility.error);
        return;
      }

      setHookOverlay(hookOverlayVisibility.hookOverlay);
      setStatusSuccess(true);
      setStatusMessage("Hook timing fitted inside the current clip.");
      return;
    }

    if (action === "move-hook") {
      setHookOverlay((current) => ({
        ...current,
        position: "top",
      }));
      setStatusSuccess(true);
      setStatusMessage("Hook moved away from the caption safe area.");
      return;
    }

    if (action === "add-broll") {
      addBrollCard();
      return;
    }

    if (action === "enable-audio") {
      setSpeechCleanupIntensity(speechCleanup.intensity === "normal" ? "more" : speechCleanup.intensity);
      setStatusSuccess(true);
      setStatusMessage("Dead air and long-pause cleanup enabled for the draft.");
      return;
    }

    requestPreviewPlayback();
    const preview = document.getElementById("clip-studio-preview");
    if (preview && window.matchMedia("(max-width: 880px)").matches) {
      preview.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start",
      });
    }
  }

  useEffect(() => {
    function handleLayerCommand(event: Event) {
      const detail = (event as CustomEvent<ClipStudioLayerCommandDetail>).detail;
      if (!detail?.command) {
        return;
      }

      if (detail.command === "toggle-captions") {
        setApplyCaptionsToClip((current) => !current);
        return;
      }

      if (detail.command === "toggle-hook") {
        const fallbackHook = onVideoCaptionText.split(/\s+/).filter(Boolean).slice(0, 9).join(" ");
        setHookOverlay((current) => ({
          ...current,
          enabled: !current.enabled,
          text: current.text.trim() || suggestedHook.trim() || fallbackHook,
        }));
        return;
      }

      if (detail.command === "toggle-broll-layer") {
        if (brollLayer.cards.length === 0) {
          addBrollCard();
          return;
        }

        setBrollLayer((current) => ({
          ...current,
          enabled: !current.enabled,
        }));
        return;
      }

      if (detail.command === "toggle-broll-card" && detail.cardId) {
        setBrollLayer((current) => ({
          ...current,
          cards: current.cards.map((card) =>
            card.id === detail.cardId ? { ...card, enabled: !card.enabled } : card,
          ),
        }));
      }
    }

    window.addEventListener(CLIP_STUDIO_LAYER_COMMAND_EVENT, handleLayerCommand);
    return () => window.removeEventListener(CLIP_STUDIO_LAYER_COMMAND_EVENT, handleLayerCommand);
  });

  useEffect(() => {
    function handleStudioKeyboard(event: KeyboardEvent) {
      if (event.defaultPrevented) {
        return;
      }

      const key = event.key.toLowerCase();
      const isEditingTarget = isKeyboardEditingTarget(event.target);

      if ((event.metaKey || event.ctrlKey) && !event.altKey) {
        if (isEditingTarget) {
          return;
        }

        if (key === "z") {
          event.preventDefault();
          if (event.shiftKey) {
            redoDraftChange();
          } else {
            undoDraftChange();
          }
          return;
        }

        if (key === "y") {
          event.preventDefault();
          redoDraftChange();
          return;
        }
      }

      if (event.metaKey || event.ctrlKey || isEditingTarget || !event.altKey || event.repeat) {
        return;
      }

      if (key === "k") {
        event.preventDefault();
        requestPreviewPlayback();
        return;
      }

      if (event.code === "BracketLeft") {
        event.preventDefault();
        applyBoundaryFromAbsoluteSeconds((timingPreview.startSeconds ?? initialStartTimeSeconds) + previewClock.sourceCurrentSeconds, "start");
        return;
      }

      if (event.code === "BracketRight") {
        event.preventDefault();
        applyBoundaryFromAbsoluteSeconds((timingPreview.startSeconds ?? initialStartTimeSeconds) + previewClock.sourceCurrentSeconds, "end");
        return;
      }

      if (key === "s") {
        event.preventDefault();
        snapToNearestSpokenLines();
        return;
      }

      if (key === "r") {
        event.preventDefault();
        resetTiming();
        return;
      }

      if (key === "c") {
        event.preventDefault();
        setApplyCaptionsToClip((current) => !current);
        return;
      }

      if (key === "h") {
        event.preventDefault();
        setHookOverlay((current) => ({
          ...current,
          enabled: !current.enabled,
          text: current.text.trim() || suggestedHook.trim() || current.text,
        }));
        return;
      }

      if (key === "b") {
        event.preventDefault();
        addBrollCard();
        return;
      }

      if (key === "a") {
        event.preventDefault();
        setSpeechCleanup((current) => {
          const nextEnabled = !(current.removeDeadAir && current.tightenLongPauses);
          return {
            ...current,
            removeDeadAir: nextEnabled,
            tightenLongPauses: nextEnabled,
          };
        });
      }
    }

    window.addEventListener("keydown", handleStudioKeyboard);
    return () => window.removeEventListener("keydown", handleStudioKeyboard);
  });

  useEffect(() => {
    function handleOverlayPosition(event: Event) {
      const detail = (event as CustomEvent<ClipStudioOverlayPositionDetail>).detail;
      if (!detail?.overlay) {
        return;
      }

      if (detail.overlay === "caption") {
        setCaptionPosition(detail.position);
        setCaptionAppearance((current) => ({
          ...current,
          verticalOffset: Math.max(-48, Math.min(48, Math.round(detail.verticalOffset))),
        }));
        return;
      }

      if (detail.overlay === "broll") {
        setBrollLayer((current) => ({
          ...current,
          cards: current.cards.map((card) =>
            card.id === detail.cardId ? { ...card, position: detail.position } : card,
          ),
        }));
        return;
      }

      setHookOverlay((current) => ({
        ...current,
        position: detail.position,
      }));
    }

    window.addEventListener(CLIP_STUDIO_OVERLAY_POSITION_EVENT, handleOverlayPosition);
    return () => window.removeEventListener(CLIP_STUDIO_OVERLAY_POSITION_EVENT, handleOverlayPosition);
  }, []);

  const speechCleanupRemovedSeconds = speechCleanupPreviewPlan.removedRanges.reduce((total, range) => total + range.removedSeconds, 0);
  const speechCleanupMarkedCount = speechCleanupPreviewPlan.removedRanges.length;
  const speechCleanupSummary = speechCleanupPreviewPlan.enabled
    ? speechCleanupMarkedCount > 0
      ? `${speechCleanupMarkedCount} pause${speechCleanupMarkedCount === 1 ? "" : "s"} tightened · ${formatCleanupDuration(
          speechCleanupRemovedSeconds,
        )} saved`
      : "No long pauses found at this intensity"
    : "Natural pacing kept";
  const hookCaptionWarning =
    hookOverlay.enabled && applyCaptionsToClip && hookOverlay.position === "lower"
      ? "Hook and captions can compete in the lower safe area. Move the hook higher before preparing."
      : null;
  const hookOverlayVisibility = useMemo(
    () => normalizeHookOverlayForClipDuration(hookOverlay, timingPreview.durationSeconds),
    [hookOverlay, timingPreview.durationSeconds],
  );
  const hookTimingWarning = hookOverlay.enabled
    ? hookOverlayVisibility.error ?? (hookOverlayVisibility.wasClamped
      ? "Hook timing extends beyond this clip. Fit it inside the visible interval before preparing."
      : null)
    : null;
  const canUndoDraft = draftHistory.past.length > 0;
  const canRedoDraft = draftHistory.future.length > 0;
  const creatorReview = useMemo(() => {
    const items: CreatorReviewItem[] = [];
    const durationSeconds = timingPreview.durationSeconds;
    const captionTextWordCount = countWords(onVideoCaptionText);
    const longCaptionCueCount = captionCues.filter((cue) => countWords(cue.text) > 16).length;
    const averageCueWords = captionCues.length > 0 ? captionTextWordCount / captionCues.length : 0;
    const hasCaptionText = captionTextWordCount > 0 && captionCues.length > 0;
    const hasHookText = hookOverlay.enabled && hookOverlay.text.trim().length > 0;
    const activeBrollCards = brollLayer.enabled
      ? brollLayer.cards.filter((card) => card.enabled && card.text.trim().length > 0)
      : [];
    const audioCleanupEnabled = speechCleanup.removeDeadAir && speechCleanup.tightenLongPauses;
    const socialCopyReady = Boolean(mainCaption.trim() && (shortCaption.trim() || platformCaption.trim() || hashtags.trim()));

    if (!timingPreview.isValid || durationSeconds === null) {
      items.push({
        id: "timing",
        label: "Timing",
        status: "needs-work",
        detail: "The clip cannot be prepared until the start and end are valid.",
        action: "fix-timing",
        actionLabel: "Draft 60s",
      });
    } else if (durationSeconds < 30 || durationSeconds > 120) {
      items.push({
        id: "timing",
        label: "Timing",
        status: "warning",
        detail: `${durationLabel} works only if the hook and landing are unusually clear.`,
        action: "fix-timing",
        actionLabel: "Make 60s",
      });
    } else {
      items.push({
        id: "timing",
        label: "Timing",
        status: "ready",
        detail: `${durationLabel} sits in a strong short-form range.`,
      });
    }

    if (!applyCaptionsToClip || !hasCaptionText) {
      items.push({
        id: "captions",
        label: "Captions",
        status: "needs-work",
        detail: "On-video captions are missing from the current composition.",
        action: "enable-captions",
        actionLabel: "Turn on",
      });
    } else if ((captionQualityScore !== null && captionQualityScore < 0.58) || captionWarnings.length >= 2) {
      items.push({
        id: "captions",
        label: "Captions",
        status: "needs-work",
        detail: "Caption quality needs review before this should be prepared.",
      });
    } else if (
      (captionQualityScore !== null && captionQualityScore < 0.8) ||
      captionWarnings.length > 0 ||
      captionImprovementSuggestions.length > 0 ||
      Boolean(translationUncertainty)
    ) {
      items.push({
        id: "captions",
        label: "Captions",
        status: "warning",
        detail: "Captions are present, but the AI feedback still has review notes.",
      });
    } else if (averageCueWords > 14 || longCaptionCueCount > 0 || captionAppearance.maxLines > 3) {
      items.push({
        id: "captions",
        label: "Captions",
        status: "warning",
        detail: "Caption blocks are a little dense for fast mobile viewing.",
        action: "tighten-captions",
        actionLabel: "Tighten",
      });
    } else {
      items.push({
        id: "captions",
        label: "Captions",
        status: "ready",
        detail: `${captionCues.length} timed caption line${captionCues.length === 1 ? "" : "s"} are active.`,
      });
    }

    if (!hasHookText) {
      items.push({
        id: "hook",
        label: "Hook",
        status: "warning",
        detail: "The opening has no hook overlay.",
        action: "add-hook",
        actionLabel: "Add hook",
      });
    } else if (hookOverlayVisibility.error) {
      items.push({
        id: "hook",
        label: "Hook",
        status: "needs-work",
        detail: hookOverlayVisibility.error,
      });
    } else if (hookOverlayVisibility.wasClamped) {
      items.push({
        id: "hook",
        label: "Hook",
        status: "warning",
        detail: "The hook timing extends beyond the visible clip interval.",
        action: "fix-hook-timing",
        actionLabel: "Fit timing",
      });
    } else if (hookCaptionWarning) {
      items.push({
        id: "hook",
        label: "Hook",
        status: "needs-work",
        detail: "The hook is competing with captions in the lower safe area.",
        action: "move-hook",
        actionLabel: "Move up",
      });
    } else {
      items.push({
        id: "hook",
        label: "Hook",
        status: "ready",
        detail: `${hookOverlay.durationSeconds}s hook overlay is active.`,
      });
    }

    if (activeBrollCards.length === 0) {
      items.push({
        id: "broll",
        label: "Visual layer",
        status: "warning",
        detail: "The clip has no visual emphasis card yet.",
        action: "add-broll",
        actionLabel: "Add card",
      });
    } else {
      items.push({
        id: "broll",
        label: "Visual layer",
        status: "ready",
        detail: `${activeBrollCards.length} visual card${activeBrollCards.length === 1 ? "" : "s"} timed for the edit.`,
      });
    }

    if (!audioCleanupEnabled) {
      items.push({
        id: "audio",
        label: "Pacing",
        status: "warning",
        detail: "Dead air and long pauses are still kept in the draft.",
        action: "enable-audio",
        actionLabel: "Polish audio",
      });
    } else if (speechCleanupPreviewPlan.enabled && speechCleanupMarkedCount > 0) {
      items.push({
        id: "audio",
        label: "Pacing",
        status: "ready",
        detail: `${speechCleanupMarkedCount} pause${speechCleanupMarkedCount === 1 ? "" : "s"} tightened, ${formatCleanupDuration(speechCleanupRemovedSeconds)} saved.`,
      });
    } else {
      items.push({
        id: "audio",
        label: "Pacing",
        status: "ready",
        detail: "Audio cleanup is enabled for this draft.",
      });
    }

    if (!socialCopyReady) {
      items.push({
        id: "copy",
        label: "Post copy",
        status: "warning",
        detail: "Caption copy and hashtags are thin for posting.",
      });
    } else {
      items.push({
        id: "copy",
        label: "Post copy",
        status: "ready",
        detail: "Posting caption copy is available.",
      });
    }

    const checklistItems: CreatorReviewChecklistItem[] = items.map((item) => ({
      ...item,
      priority:
        item.id === "timing" || (item.id === "captions" && applyCaptionsToClip)
          ? "required"
          : item.id === "captions" || item.id === "hook" || item.id === "audio"
            ? "recommended"
            : "optional",
    }));
    const summarizePriority = (priority: CreatorReviewPriority) => {
      const priorityItems = checklistItems.filter((item) => item.priority === priority);
      return {
        priority,
        ready: priorityItems.filter((item) => item.status === "ready").length,
        total: priorityItems.length,
        needsWork: priorityItems.filter((item) => item.status === "needs-work").length,
      };
    };
    const summary = [
      summarizePriority("required"),
      summarizePriority("recommended"),
      summarizePriority("optional"),
    ];
    const required = summary[0];
    const recommended = summary[1];
    const hasRequiredWork = Boolean(required && required.ready < required.total);
    const hasRecommendedWork = Boolean(recommended && recommended.ready < recommended.total);

    return {
      items: checklistItems,
      summary,
      label: hasRequiredWork
        ? "Required checks remain"
        : hasRecommendedWork
          ? "Ready with suggestions"
          : "Ready to prepare",
      tone: hasRequiredWork ? "danger" as const : hasRecommendedWork ? "accent" as const : "success" as const,
    };
  }, [
    applyCaptionsToClip,
    brollLayer,
    captionAppearance.maxLines,
    captionCues,
    captionImprovementSuggestions.length,
    captionQualityScore,
    captionWarnings.length,
    durationLabel,
    hashtags,
    mainCaption,
    hookCaptionWarning,
    hookOverlayVisibility,
    hookOverlay.durationSeconds,
    hookOverlay.enabled,
    hookOverlay.text,
    onVideoCaptionText,
    platformCaption,
    shortCaption,
    speechCleanup.removeDeadAir,
    speechCleanup.tightenLongPauses,
    speechCleanupMarkedCount,
    speechCleanupPreviewPlan.enabled,
    speechCleanupRemovedSeconds,
    timingPreview.durationSeconds,
    timingPreview.isValid,
    translationUncertainty,
  ]);

  return (
    <section className="stack-lg">
      <div hidden>
      <SectionCard title="Timing" description="Adjust the clip boundaries before rendering.">
        <div className="actions-row">
          <p className="muted small">Times are based on the original sermon video.</p>
          <StatusBadge tone={timingGuidance.tone}>{timingGuidance.label}</StatusBadge>
        </div>
        <div className="clip-studio-effect-note">
          <StatusBadge tone="success">Live preview</StatusBadge>
          <p>Timing changes update the preview immediately. Prepare when the preview looks right.</p>
        </div>

        <div className="clip-studio-simple-timing">
          <div className="review-edit-grid">
            <label className="stack-sm">
              Start
              <input
                value={startTimestamp}
                onChange={(event) => setStartTimestamp(event.target.value)}
                disabled={isPending}
                aria-invalid={Boolean(fieldErrors?.startTimestamp)}
              />
              {fieldErrors?.startTimestamp ? (
                <span className="error-text small">{fieldErrors.startTimestamp}</span>
              ) : null}
            </label>

            <label className="stack-sm">
              End
              <input
                value={endTimestamp}
                onChange={(event) => setEndTimestamp(event.target.value)}
                disabled={isPending}
                aria-invalid={Boolean(fieldErrors?.endTimestamp)}
              />
              {fieldErrors?.endTimestamp ? (
                <span className="error-text small">{fieldErrors.endTimestamp}</span>
              ) : null}
            </label>

            <div className="stack-sm">
              <span className="muted small">Duration</span>
              <p>{durationLabel}</p>
            </div>
          </div>

          <div className="clip-studio-simple-actions">
            <div className="clip-studio-quick-lengths" aria-label="Quick clip lengths">
              {QUICK_CLIP_LENGTH_SECONDS.map((lengthSeconds) => (
                <button
                  key={lengthSeconds}
                  type="button"
                  className="button secondary"
                  onClick={() => setDurationFromCurrentStart(lengthSeconds)}
                  disabled={isPending}
                >
                  {lengthSeconds}s
                </button>
              ))}
            </div>
          </div>
        </div>

        <details hidden className="clip-studio-editor-disclosure">
          <summary>
            <span>Trim controls</span>
            <span className="muted small">Nudge starts, ends, and spoken lines</span>
          </summary>
          <div className="stack-md">
        {trimTrack ? (
          <div className="clip-studio-timeline clip-studio-edit-deck stack-sm">
            <div className="clip-studio-edit-deck-head">
              <div>
                <p className="kicker">Timeline editor</p>
                <strong>{formatSecondsForPastorView(trimTrack.start)} - {formatSecondsForPastorView(trimTrack.end)}</strong>
              </div>
              <div className="clip-studio-edit-deck-meta">
                <span>In {formatSecondsForPastorView(trimTrack.start)}</span>
                <span>Out {formatSecondsForPastorView(trimTrack.end)}</span>
                <span>{durationLabel}</span>
              </div>
            </div>
            <div className="clip-studio-quick-lengths" aria-label="Quick clip lengths">
              {QUICK_CLIP_LENGTH_SECONDS.map((lengthSeconds) => (
                <button
                  key={lengthSeconds}
                  type="button"
                  className="button secondary"
                  onClick={() => setDurationFromCurrentStart(lengthSeconds)}
                  disabled={isPending}
                >
                  {lengthSeconds}s
                </button>
              ))}
            </div>
            <div className="clip-studio-timeline-track clip-studio-timeline-track-interactive" aria-label="Clip trim timeline" onClick={onTimelineClick}>
              {playhead ? (
                <span
                  className="clip-studio-timeline-playhead"
                  style={{ left: `${playhead.percent}%` }}
                  aria-hidden="true"
                />
              ) : null}
              <span
                className="clip-studio-timeline-selection"
                style={{ left: `${trimTrack.startPercent}%`, width: `${trimTrack.widthPercent}%` }}
              />
              {deadAirCutMarkers.map((cut) => (
                <span
                  key={cut.id}
                  className={[
                    "clip-studio-timeline-dead-air",
                    cut.source === "audio" ? "is-audio" : "is-transcript",
                  ].join(" ")}
                  style={{ left: `${cut.leftPercent}%`, width: `${cut.widthPercent}%` }}
                  title={cut.title}
                >
                  <span className="clip-studio-timeline-cut-label">{cut.label}</span>
                </span>
              ))}
              {aiBoundaryMarkers.map((marker) => (
                <span
                  key={marker.id}
                  className="clip-studio-timeline-ai-marker"
                  style={{ left: `${marker.percent}%` }}
                  title={marker.label}
                />
              ))}
              <span
                className="clip-studio-timeline-handle"
                style={{ left: `${trimTrack.startPercent}%` }}
              />
              <span
                className="clip-studio-timeline-handle"
                style={{ left: `${trimTrack.startPercent + trimTrack.widthPercent}%` }}
              />
              <input
                className="clip-studio-timeline-slider clip-studio-timeline-slider-start"
                type="range"
                min={localTimeline.start}
                max={localTimeline.end}
                step={0.1}
                value={sliderStartSeconds}
                onChange={(event) => onStartSliderChange(Number(event.target.value))}
                disabled={isPending}
                aria-label="Clip start handle"
              />
              <input
                className="clip-studio-timeline-slider clip-studio-timeline-slider-end"
                type="range"
                min={localTimeline.start}
                max={localTimeline.end}
                step={0.1}
                value={sliderEndSeconds}
                onChange={(event) => onEndSliderChange(Number(event.target.value))}
                disabled={isPending}
                aria-label="Clip end handle"
              />
            </div>
            {transcriptClipBlocks.length > 0 ? (
              <div className="clip-studio-transcript-strip" aria-label="Transcript line timeline" onClick={onTimelineClick}>
                {playhead ? (
                  <span
                    className="clip-studio-transcript-playhead"
                    style={{ left: `${playhead.percent}%` }}
                    aria-hidden="true"
                  />
                ) : null}
                {transcriptClipBlocks.map((segment) => (
                  <button
                    key={segment.id}
                    type="button"
                    className={[
                      "clip-studio-transcript-block",
                      segment.isSelected ? "is-selected" : "",
                      focusedSegmentId === segment.id ? "is-focused" : "",
                    ].filter(Boolean).join(" ")}
                    style={{ left: `${segment.leftPercent}%`, width: `${segment.widthPercent}%` }}
                    title={`${formatSecondsForPastorView(segment.startTimeSeconds)} - ${segment.text}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setFocusedSegmentId(segment.id);
                      seekPreviewToAbsolute(segment.startTimeSeconds);
                    }}
                    disabled={isPending}
                  >
                    <span>{segment.index + 1}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {focusedSegment ? (
              <div className="clip-studio-selected-line">
                <div>
                  <span className="kicker">Selected line</span>
                  <strong>
                    {formatSecondsForPastorView(focusedSegment.startTimeSeconds)} - {formatSecondsForPastorView(focusedSegment.endTimeSeconds)}
                  </strong>
                  <p className="muted small">{focusedSegment.text}</p>
                </div>
                <div className="clip-studio-selected-line-actions">
                  <button type="button" className="button secondary" onClick={() => applyBoundaryFromSegment(focusedSegment, "start")} disabled={isPending}>
                    Set start
                  </button>
                  <button type="button" className="button secondary" onClick={() => applyBoundaryFromSegment(focusedSegment, "end")} disabled={isPending}>
                    Set end
                  </button>
                  <button type="button" className="button secondary" onClick={() => seekPreviewToAbsolute(focusedSegment.startTimeSeconds)} disabled={isPending}>
                    Preview line
                  </button>
                  <button type="button" className="button secondary" onClick={() => buildClipAroundSegment(focusedSegment, 60)} disabled={isPending}>
                    Build 60s
                  </button>
                </div>
              </div>
            ) : null}
            <div className="clip-studio-timeline-labels muted small">
              <span>{formatSecondsForPastorView(trimTrack.visibleStart)}</span>
              <span>{playhead ? `Playhead ${playhead.label}` : "Local edit window"}</span>
              <span>{formatSecondsForPastorView(trimTrack.visibleEnd)}</span>
            </div>
          </div>
        ) : null}
        <div className="clip-studio-timing-tools">
          <div className="clip-studio-boundary-readout">
            <article>
              <span className="kicker">Starts on</span>
              <strong>{activeBoundarySegments.first ? formatSecondsForPastorView(activeBoundarySegments.first.startTimeSeconds) : "N/A"}</strong>
              <p className="muted small">{activeBoundarySegments.first?.text ?? "No nearby spoken line found."}</p>
            </article>
            <article>
              <span className="kicker">Ends on</span>
              <strong>{activeBoundarySegments.last ? formatSecondsForPastorView(activeBoundarySegments.last.endTimeSeconds) : "N/A"}</strong>
              <p className="muted small">{activeBoundarySegments.last?.text ?? "No nearby spoken line found."}</p>
            </article>
            <article>
              <span className="kicker">Selected text</span>
              <strong>{activeBoundarySegments.count} line{activeBoundarySegments.count === 1 ? "" : "s"}</strong>
              <p className="muted small">{timingGuidance.description}</p>
            </article>
          </div>
          <div className="clip-studio-nudge-grid" aria-label="Precise timing controls">
            <div>
              <span className="muted small">Start</span>
              <button type="button" className="button secondary" onClick={() => nudgeBoundary("start", -1)} disabled={isPending}>-1s</button>
              <button type="button" className="button secondary" onClick={() => nudgeBoundary("start", -0.25)} disabled={isPending}>-0.25s</button>
              <button type="button" className="button secondary" onClick={() => nudgeBoundary("start", 0.25)} disabled={isPending}>+0.25s</button>
              <button type="button" className="button secondary" onClick={() => nudgeBoundary("start", 1)} disabled={isPending}>+1s</button>
            </div>
            <div>
              <span className="muted small">End</span>
              <button type="button" className="button secondary" onClick={() => nudgeBoundary("end", -1)} disabled={isPending}>-1s</button>
              <button type="button" className="button secondary" onClick={() => nudgeBoundary("end", -0.25)} disabled={isPending}>-0.25s</button>
              <button type="button" className="button secondary" onClick={() => nudgeBoundary("end", 0.25)} disabled={isPending}>+0.25s</button>
              <button type="button" className="button secondary" onClick={() => nudgeBoundary("end", 1)} disabled={isPending}>+1s</button>
            </div>
          </div>
          <div className="actions-row">
            <button type="button" className="button secondary" onClick={snapToNearestSpokenLines} disabled={isPending || transcriptSegments.length === 0}>
              Snap to Sentence
            </button>
            <button type="button" className="button secondary" onClick={resetTiming} disabled={isPending}>
              Reset to AI
            </button>
          </div>
        </div>
        {transcriptSegments.length > 0 ? (
          <div className="transcript-trim-panel stack-sm">
            <p className="muted small">Transcript trim</p>
            <div className="review-edit-grid">
              <label className="stack-sm">
                First spoken line
                <select value={firstSegmentId} onChange={(event) => setFirstSegmentId(event.target.value)} disabled={isPending}>
                  {transcriptSegments.map((segment) => (
                    <option key={segment.id} value={segment.id}>
                      {formatSecondsForPastorView(segment.startTimeSeconds)} - {segment.text.slice(0, 92)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="stack-sm">
                Last spoken line
                <select value={lastSegmentId} onChange={(event) => setLastSegmentId(event.target.value)} disabled={isPending}>
                  {transcriptSegments.map((segment) => (
                    <option key={segment.id} value={segment.id}>
                      {formatSecondsForPastorView(segment.endTimeSeconds)} - {segment.text.slice(0, 92)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button type="button" className="button secondary" onClick={applyTranscriptTrim} disabled={isPending}>
              Use selected sermon text
            </button>
          </div>
        ) : null}
          </div>
        </details>

        {timingPreview.warnings.length > 0 ? (
          <ul className="warning-list">
            {timingPreview.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : null}
      </SectionCard>
      </div>

      <SectionCard title="Final check" className="clip-studio-creator-review">
        <div className="clip-studio-creator-review-hero">
          <div className="clip-studio-review-checklist-summary" aria-label="Preparation checklist summary">
            {creatorReview.summary.map((group) => (
              <span key={group.priority} className={`is-${group.priority}`}>
                <strong>{group.ready}/{group.total}</strong>
                {group.priority}
              </span>
            ))}
          </div>
          <div className="clip-studio-creator-review-summary">
            <div className="actions-row">
              <StatusBadge tone={creatorReview.tone}>{creatorReview.label}</StatusBadge>
              <button type="button" className="button secondary" onClick={() => applyCreatorReviewAction("preview")}>
                Preview
              </button>
            </div>
            <p className="muted small">
              Required checks protect the final video. Recommended and optional ideas can be skipped when they do not fit the sermon moment.
            </p>
          </div>
        </div>

        <div className="clip-studio-creator-review-grid">
          {creatorReview.items.map((item) => (
            <article
              key={item.id}
              className={`clip-studio-creator-review-item is-${item.status}`}
            >
              <div>
                <div className="clip-studio-creator-review-item-head">
                  <div>
                    <span className={`clip-studio-review-priority is-${item.priority}`}>{item.priority}</span>
                    <strong>{item.label}</strong>
                  </div>
                  <StatusBadge tone={getCreatorReviewStatusTone(item.status)}>{getCreatorReviewStatusLabel(item.status)}</StatusBadge>
                </div>
                <p className="muted small">{item.detail}</p>
              </div>
              {item.action && item.actionLabel ? (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => applyCreatorReviewAction(item.action as CreatorReviewAction)}
                  disabled={isPending}
                >
                  {item.actionLabel}
                </button>
              ) : null}
            </article>
          ))}
        </div>
      </SectionCard>

      <details ref={audioReviewSectionRef} className="clip-studio-editor-disclosure">
        <summary>
          <span>Audio cleanup</span>
          <span className="muted small">{speechCleanupSummary}</span>
        </summary>
      <SectionCard title="Audio">
        <div className="stack-md">
          <p className="status-help">{speechCleanupSummary}</p>
          <p className="muted small" role="status">{audioSilenceReviewMessage}</p>
          <label className="clip-studio-toggle-row">
            <input
              type="checkbox"
              aria-label="Remove dead air and long pauses"
              checked={speechCleanup.removeDeadAir && speechCleanup.tightenLongPauses}
              onChange={(event) =>
                setSpeechCleanup((current) => ({
                  ...current,
                  removeDeadAir: event.target.checked,
                  tightenLongPauses: event.target.checked,
                }))
              }
              disabled={isPending}
            />
            <span>
              <strong>Remove dead air and long pauses</strong>
            </span>
          </label>

          <div className="clip-studio-intensity-control">
            <p className="kicker">Intensity</p>
            <div className="clip-studio-quick-lengths clip-studio-intensity-row" aria-label="Dead air removal intensity">
              {SPEECH_CLEANUP_INTENSITIES.map((intensity) => (
                <button
                  key={intensity}
                  type="button"
                  className="button secondary"
                  aria-pressed={speechCleanup.intensity === intensity}
                  onClick={() => setSpeechCleanupIntensity(intensity)}
                  disabled={isPending}
                  title={`Use ${SPEECH_CLEANUP_INTENSITY_LABELS[intensity].toLowerCase()} dead air removal`}
                >
                  {SPEECH_CLEANUP_INTENSITY_LABELS[intensity]}
                </button>
              ))}
            </div>
          </div>

          <div className="clip-studio-boundary-readout">
            <article>
              <span className="kicker">Preview duration</span>
              <strong>
                {speechCleanupPreviewPlan.enabled
                  ? formatSecondsForPastorView(speechCleanupPreviewPlan.cleanedDurationSeconds)
                  : durationLabel}
              </strong>
            </article>
            <article>
              <span className="kicker">Dead air</span>
              <strong>{speechCleanup.removeDeadAir ? "Will remove" : "Kept"}</strong>
            </article>
            <article>
              <span className="kicker">Long pauses</span>
              <strong>{speechCleanup.tightenLongPauses ? `${speechCleanupMarkedCount} tightened` : "Kept"}</strong>
            </article>
          </div>
        </div>
      </SectionCard>
      </details>

      <SectionCard
        title="Social post copy"
        description="Prepare the words that travel with the video on social platforms. These fields do not change the timed words shown inside the clip."
      >
        <div className="stack-md">
          <div className="clip-studio-effect-note">
            <StatusBadge tone="accent">Separate from subtitles</StatusBadge>
            <p>On-video captions stay in the caption editor below. This copy is used for publishing and download packages.</p>
          </div>

          <label className="stack-sm">
            Clip title
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="A clear title for this sermon moment"
              disabled={isPending}
            />
          </label>
          {titleOptions.length > 0 ? (
            <div className="stack-sm">
              <span className="muted small">Transcript-grounded title ideas</span>
              <div className="actions-row">
                {titleOptions.filter((option) => option.trim() && option.trim() !== title.trim()).slice(0, 3).map((option) => (
                  <button key={option} type="button" className="button tertiary" onClick={() => setTitle(option.trim())} disabled={isPending}>
                    {option}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <label className="stack-sm">
            Post opener
            <textarea
              className="clip-studio-caption-textarea"
              value={editorialHook}
              onChange={(event) => setEditorialHook(event.target.value)}
              placeholder="A grounded opening line for the social post"
              disabled={isPending}
            />
          </label>
          {suggestedHook.trim() && suggestedHook.trim() !== editorialHook.trim() ? (
            <button type="button" className="button secondary" onClick={useSuggestedPostHook} disabled={isPending}>
              Use suggested opener
            </button>
          ) : null}
          {hookOptions.length > 0 ? (
            <div className="actions-row" aria-label="Alternative post openers">
              {hookOptions.filter((option) => option.trim() && option.trim() !== editorialHook.trim()).slice(0, 3).map((option) => (
                <button key={option} type="button" className="button tertiary" onClick={() => setEditorialHook(option.trim())} disabled={isPending}>
                  {option}
                </button>
              ))}
            </div>
          ) : null}

          <label className="stack-sm">
            Main post caption
            <textarea
              className="clip-studio-caption-textarea"
              value={mainCaption}
              onChange={(event) => setMainCaption(event.target.value)}
              placeholder="Explain why this sermon moment matters"
              disabled={isPending}
            />
          </label>
          {suggestedCaption.trim() && suggestedCaption.trim() !== mainCaption.trim() ? (
            <button type="button" className="button secondary" onClick={useSuggestedPostCaption} disabled={isPending}>
              Use suggested caption
            </button>
          ) : null}

          {ctaOptions.length > 0 ? (
            <div className="stack-sm">
              <span className="muted small">Optional ministry next steps</span>
              <div className="actions-row">
                {ctaOptions.slice(0, 3).map((option) => (
                  <button
                    key={option}
                    type="button"
                    className="button tertiary"
                    onClick={() => setMainCaption((current) => `${current.trim()}${current.trim() ? "\n\n" : ""}${option.trim()}`)}
                    disabled={isPending || !option.trim() || mainCaption.includes(option.trim())}
                  >
                    Add: {option}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="review-edit-grid">
            <label className="stack-sm">
              Short caption
              <textarea
                className="clip-studio-caption-textarea"
                value={shortCaption}
                onChange={(event) => setShortCaption(event.target.value)}
                placeholder="A concise version for fast-moving feeds"
                disabled={isPending}
              />
            </label>
            <label className="stack-sm">
              Direct platform caption
              <textarea
                className="clip-studio-caption-textarea"
                value={platformCaption}
                onChange={(event) => setPlatformCaption(event.target.value)}
                placeholder="A more conversational alternative"
                disabled={isPending}
              />
            </label>
          </div>

          <label className="stack-sm">
            Hashtags
            <input
              value={hashtags}
              onChange={(event) => setHashtags(event.target.value)}
              placeholder="#faith #sermon #church"
              disabled={isPending}
              aria-invalid={Boolean(fieldErrors?.hashtags)}
            />
            <span className="muted small">Use only tags that genuinely describe this moment.</span>
          </label>
          {fieldErrors?.hashtags ? <span className="error-text small">{fieldErrors.hashtags}</span> : null}
        </div>
      </SectionCard>

      <SectionCard title="On-video captions & hook">
        <div className="stack-md clip-studio-caption-form">
          <label className="clip-studio-toggle-row">
            <input
              type="checkbox"
              aria-label="Captions"
              checked={applyCaptionsToClip}
              onChange={(event) => setApplyCaptionsToClip(event.target.checked)}
              disabled={isPending}
            />
            <span>
              <strong>Captions</strong>
            </span>
          </label>

          <section className="clip-studio-caption-timing-panel" aria-labelledby="caption-reveal-heading">
            <div className="section-heading-row compact">
              <div>
                <p className="kicker">Words on screen</p>
                <h3 id="caption-reveal-heading">Choose how captions appear</h3>
              </div>
              <StatusBadge tone="accent">
                {captionRevealMode === "single-word" ? "1 word pop" : captionRevealMode === "active-word" ? "Active word" : "Phrase"}
              </StatusBadge>
            </div>
            <div className="clip-studio-caption-reveal-options" role="group" aria-label="Caption reveal style">
              <button
                type="button"
                className={captionRevealMode === "phrase" ? "clip-studio-caption-reveal-option is-active" : "clip-studio-caption-reveal-option"}
                aria-pressed={captionRevealMode === "phrase"}
                onClick={() => changeCaptionRevealMode("phrase")}
                disabled={isPending || !applyCaptionsToClip}
              >
                <strong>Phrase</strong>
                <span>Readable lines</span>
              </button>
              <button
                type="button"
                className={captionRevealMode === "active-word" ? "clip-studio-caption-reveal-option is-active" : "clip-studio-caption-reveal-option"}
                aria-pressed={captionRevealMode === "active-word"}
                onClick={() => changeCaptionRevealMode("active-word")}
                disabled={isPending || !applyCaptionsToClip}
              >
                <strong>Active word</strong>
                <span>Current word lights up</span>
              </button>
              <button
                type="button"
                className={captionRevealMode === "single-word" ? "clip-studio-caption-reveal-option is-active" : "clip-studio-caption-reveal-option"}
                aria-pressed={captionRevealMode === "single-word"}
                onClick={() => changeCaptionRevealMode("single-word")}
                disabled={isPending || !applyCaptionsToClip}
              >
                <strong>1 word pop</strong>
                <span>One spoken word at a time</span>
              </button>
            </div>

            <div className="clip-studio-caption-sync-control">
              <div>
                <strong>Caption sync</strong>
                <p className="muted small">If every caption feels early or late, move all words together.</p>
              </div>
              <label className="stack-sm">
                Timing offset
                <input
                  aria-label="Caption timing offset"
                  type="range"
                  min={-2}
                  max={2}
                  step={0.05}
                  value={captionSyncOffsetSeconds}
                  onChange={(event) => setCaptionSyncOffset(Number(event.target.value))}
                  disabled={isPending || !applyCaptionsToClip}
                />
              </label>
              <div className="clip-studio-caption-sync-actions">
                <button type="button" className="button tertiary" onClick={() => setCaptionSyncOffset(captionSyncOffsetSeconds - 0.1)} disabled={isPending || !applyCaptionsToClip}>
                  Earlier 0.1s
                </button>
                <button type="button" className="button tertiary" onClick={() => setCaptionSyncOffset(0)} disabled={isPending || !applyCaptionsToClip || captionSyncOffsetSeconds === 0}>
                  Reset
                </button>
                <button type="button" className="button tertiary" onClick={() => setCaptionSyncOffset(captionSyncOffsetSeconds + 0.1)} disabled={isPending || !applyCaptionsToClip}>
                  Later 0.1s
                </button>
                <output aria-live="polite">
                  {captionSyncOffsetSeconds === 0 ? "On time" : `${captionSyncOffsetSeconds > 0 ? "+" : ""}${captionSyncOffsetSeconds.toFixed(2)}s`}
                </output>
              </div>
              <button
                type="button"
                className="button secondary"
                onClick={resyncCaptionsFromSpeech}
                disabled={isPending || !applyCaptionsToClip || transcriptSegments.length === 0}
              >
                Re-sync words from speech
              </button>
            </div>
          </section>

          <details className="clip-studio-caption-dropdown">
            <summary aria-label={`Caption lines, ${captionLineLabel}, captions ${applyCaptionsToClip ? "on" : "off"}`}>
              <span className="clip-studio-caption-dropdown-copy">
                <span className="kicker">Caption lines</span>
                <strong>{captionLineLabel}</strong>
                <span aria-hidden="true" className="clip-studio-caption-dropdown-preview">{captionDropdownPreview}</span>
              </span>
              <span className="clip-studio-caption-dropdown-meta">
                <StatusBadge tone={applyCaptionsToClip ? "success" : "neutral"}>
                  {applyCaptionsToClip ? "On" : "Off"}
                </StatusBadge>
                <span aria-hidden="true" className="clip-studio-caption-dropdown-chevron">v</span>
              </span>
            </summary>

            <div className="clip-studio-caption-dropdown-body">
              {captionRevealMode === "single-word" ? (
                <div className="clip-studio-caption-word-pop-summary">
                  <strong>{captionCues.length} spoken-word pops</strong>
                  <p className="muted small">
                    Each pop follows detected speech timing. Re-sync rebuilds that timing; review or correct wording in Transcript review. Style, size, position, and sync offset remain customizable below.
                  </p>
                  <p>{captionCues.slice(0, 12).map((cue) => cue.text).join(" · ")}{captionCues.length > 12 ? " …" : ""}</p>
                </div>
              ) : (
                <div className="clip-studio-caption-cue-list">
                {captionCues.map((cue, index) => {
                  const cueTextEdited = isCaptionCueTextEdited(cue);

                  return (
                    <div className="clip-studio-caption-cue" key={`${cue.index}-${index}`}>
                      <div className="clip-studio-caption-cue-times">
                        <label className="stack-sm">
                          Start
                          <input
                            type="number"
                            min={0}
                            step={0.1}
                            value={cue.startSeconds}
                            readOnly
                            disabled={isPending || !applyCaptionsToClip}
                          />
                        </label>
                        <label className="stack-sm">
                          End
                          <input
                            type="number"
                            min={0}
                            step={0.1}
                            value={cue.endSeconds}
                            readOnly
                            disabled={isPending || !applyCaptionsToClip}
                          />
                        </label>
                      </div>
                      <label className="stack-sm clip-studio-caption-cue-text">
                        Transcript line {index + 1}
                        <textarea
                          aria-label={`Edit caption words for transcript line ${index + 1}`}
                          className="clip-studio-caption-textarea"
                          value={cue.text}
                          onChange={(event) => updateCaptionCueText(cue, event.target.value)}
                          disabled={isPending || !applyCaptionsToClip}
                        />
                      </label>
                      {cueTextEdited ? (
                        <button
                          type="button"
                          className="button secondary"
                          onClick={() => resetCaptionCueText(cue)}
                          disabled={isPending || !applyCaptionsToClip}
                        >
                          Reset line
                        </button>
                      ) : null}
                    </div>
                  );
                })}
                </div>
              )}
              {fieldErrors?.captionCues ? (
                <span className="error-text small">{fieldErrors.captionCues}</span>
              ) : null}
            </div>
          </details>

          <section className="clip-studio-caption-style-panel" aria-labelledby="clip-caption-style-heading">
            <div className="section-heading-row compact">
              <div>
                <p className="kicker">Caption personality</p>
                <h3 id="clip-caption-style-heading">Style for this clip</h3>
              </div>
              <StatusBadge tone="accent">{resolvedCaptionStyle.name}</StatusBadge>
            </div>

            <div className="clip-studio-selected-style">
              <span className={`clip-studio-caption-style-preview ${resolvedCaptionStyle.className}`}>
                {resolvedCaptionStyle.sampleText}
              </span>
              <div>
                <strong>{resolvedCaptionStyle.name}</strong>
                <p className="muted small">{resolvedCaptionStyle.description}</p>
                <div className="clip-studio-caption-style-meta" aria-label="Selected caption style details">
                  <span>{resolvedCaptionStyle.personality}</span>
                  <span>{resolvedCaptionStyle.motion}</span>
                  <span>{resolvedCaptionStyle.bestFor}</span>
                </div>
              </div>
            </div>

            <label className="stack-sm">
              Caption position
              <select
                aria-label="Caption position"
                value={captionPosition}
                onChange={(event) => setCaptionPosition(event.target.value as CaptionPosition)}
                disabled={isPending || !applyCaptionsToClip}
              >
                <option value="lower">Lower</option>
                <option value="middle">Middle</option>
                <option value="top">Top</option>
              </select>
            </label>

            <div className="clip-studio-caption-appearance-grid" aria-label="Caption appearance controls">
              <label className="stack-sm">
                Text size
                <select
                  aria-label="Caption text size"
                  value={captionAppearance.fontScale}
                  onChange={(event) =>
                    setCaptionAppearance((current) => ({
                      ...current,
                      fontScale: event.target.value as CaptionFontScale,
                    }))
                  }
                  disabled={isPending || !applyCaptionsToClip}
                >
                  <option value="compact">Compact</option>
                  <option value="regular">Regular</option>
                  <option value="large">Large</option>
                </select>
              </label>

              <label className="stack-sm">
                Max lines
                <select
                  aria-label="Caption max lines"
                  value={captionAppearance.maxLines}
                  onChange={(event) =>
                    setCaptionAppearance((current) => ({
                      ...current,
                      maxLines: Number(event.target.value) as CaptionMaxLines,
                    }))
                  }
                  disabled={isPending || !applyCaptionsToClip}
                >
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                  <option value={4}>4</option>
                </select>
              </label>

              <label className="stack-sm">
                Safe offset
                <input
                  aria-label="Caption vertical offset"
                  type="range"
                  min={-48}
                  max={48}
                  step={4}
                  value={captionAppearance.verticalOffset}
                  onChange={(event) =>
                    setCaptionAppearance((current) => ({
                      ...current,
                      verticalOffset: Number(event.target.value),
                    }))
                  }
                  disabled={isPending || !applyCaptionsToClip}
                />
                <span className="muted small">{captionAppearance.verticalOffset}px</span>
              </label>

              <label className="clip-studio-toggle-row compact">
                <input
                  type="checkbox"
                  aria-label="Uppercase caption text"
                  checked={captionAppearance.uppercase}
                  onChange={(event) =>
                    setCaptionAppearance((current) => ({
                      ...current,
                      uppercase: event.target.checked,
                    }))
                  }
                  disabled={isPending || !applyCaptionsToClip}
                />
                <span>
                  <strong>Uppercase</strong>
                </span>
              </label>
            </div>

            <details className="clip-studio-editor-disclosure compact" open>
              <summary>
                <span>Change caption style</span>
                <span className="muted small">Show all style previews</span>
              </summary>
              <div className="clip-studio-caption-style-grid">
                <button
                  type="button"
                  aria-pressed={captionStylePresetId === ""}
                  className={captionStylePresetId === "" ? "clip-studio-caption-style-option is-active" : "clip-studio-caption-style-option"}
                  onClick={() => setCaptionStylePresetId("")}
                  disabled={isPending}
                >
                  <strong>Brand Kit default</strong>
                  <span>{resolveCaptionStylePreset(brandCaptionStylePresetId).name}</span>
                  <span>{resolveCaptionStylePreset(brandCaptionStylePresetId).bestFor}</span>
                </button>
                {CAPTION_STYLE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    aria-pressed={captionStylePresetId === preset.id}
                    className={captionStylePresetId === preset.id ? "clip-studio-caption-style-option is-active" : "clip-studio-caption-style-option"}
                    onClick={() => setCaptionStylePresetId(preset.id)}
                    disabled={isPending}
                  >
                    <span className={`clip-studio-caption-style-preview ${preset.className}`}>{preset.sampleText}</span>
                    <strong>{preset.name}</strong>
                    <span>{preset.motion}</span>
                    <span>{preset.bestFor}</span>
                  </button>
                ))}
              </div>
            </details>
          </section>

          <section className="clip-studio-hook-panel" aria-labelledby="clip-hook-heading">
            <div className="section-heading-row compact">
              <div>
                <p className="kicker">Hook overlay</p>
                <h3 id="clip-hook-heading">Opening hook</h3>
              </div>
              <StatusBadge tone={hookOverlay.enabled ? "success" : "neutral"}>
                {hookOverlay.enabled ? `${hookOverlay.durationSeconds}s` : "Off"}
              </StatusBadge>
            </div>
            <label className="clip-studio-toggle-row">
              <input
                type="checkbox"
                aria-label="Show hook on the clip"
                checked={hookOverlay.enabled}
                onChange={(event) => setHookOverlay((current) => ({ ...current, enabled: event.target.checked }))}
                disabled={isPending}
              />
              <span>
                <strong>Show hook on the clip</strong>
                <small>Default duration is 6 seconds.</small>
              </span>
            </label>

            <label className="stack-sm">
              Hook text
              <textarea
                className="clip-studio-caption-textarea"
                value={hookOverlay.text}
                onChange={(event) => {
                  setHookOverlay((current) => ({ ...current, text: event.target.value }));
                }}
                disabled={isPending || !hookOverlay.enabled}
              />
            </label>
            {fieldErrors?.hook ? (
              <span className="error-text small">{fieldErrors.hook}</span>
            ) : null}
            {hookCaptionWarning ? <p className="warning-banner">{hookCaptionWarning}</p> : null}
            {hookTimingWarning ? <p className="warning-banner">{hookTimingWarning}</p> : null}
            {suggestedHook.trim() ? (
              <button type="button" className="button secondary" onClick={useSuggestedHook} disabled={isPending}>
                Use suggestion as on-screen hook
              </button>
            ) : null}

            <details className="clip-studio-editor-disclosure compact">
              <summary>
                <span>Hook advanced controls</span>
                <span className="muted small">Position, timing, animation</span>
              </summary>
            <div className="clip-studio-hook-grid">
              <label className="stack-sm">
                Position
                <select
                  value={hookOverlay.position}
                  onChange={(event) =>
                    setHookOverlay((current) => ({
                      ...current,
                      position: event.target.value as HookOverlayConfig["position"],
                    }))
                  }
                  disabled={isPending || !hookOverlay.enabled}
                >
                  <option value="top">Top</option>
                  <option value="center">Center</option>
                  <option value="lower">Lower</option>
                </select>
              </label>
              <label className="stack-sm">
                Starts at
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={hookOverlay.startSeconds}
                  onChange={(event) => setHookOverlay((current) => ({ ...current, startSeconds: Number(event.target.value) }))}
                  disabled={isPending || !hookOverlay.enabled}
                />
              </label>
              <label className="stack-sm">
                Duration
                <input
                  type="number"
                  min={1}
                  max={20}
                  step={0.5}
                  value={hookOverlay.durationSeconds}
                  onChange={(event) => setHookOverlay((current) => ({ ...current, durationSeconds: Number(event.target.value) }))}
                  disabled={isPending || !hookOverlay.enabled}
                />
              </label>
              <label className="stack-sm">
                Animation
                <select
                  value={hookOverlay.animation}
                  onChange={(event) =>
                    setHookOverlay((current) => ({
                      ...current,
                      animation: event.target.value as HookOverlayConfig["animation"],
                    }))
                  }
                  disabled={isPending || !hookOverlay.enabled}
                >
                  <option value="fade">Fade</option>
                  <option value="pan-in">Pan in</option>
                  <option value="pop">Pop</option>
                  <option value="none">None</option>
                </select>
              </label>
              <label className="stack-sm">
                Size
                <select
                  value={hookOverlay.size}
                  onChange={(event) =>
                    setHookOverlay((current) => ({
                      ...current,
                      size: event.target.value as HookOverlayConfig["size"],
                    }))
                  }
                  disabled={isPending || !hookOverlay.enabled}
                >
                  <option value="small">Small</option>
                  <option value="medium">Medium</option>
                  <option value="large">Large</option>
                </select>
              </label>
              <label className="clip-studio-toggle-row compact">
                <input
                  type="checkbox"
                  aria-label="Bold hook text"
                  checked={hookOverlay.bold}
                  onChange={(event) => setHookOverlay((current) => ({ ...current, bold: event.target.checked }))}
                  disabled={isPending || !hookOverlay.enabled}
                />
                <span>
                  <strong>Bold</strong>
                </span>
              </label>
            </div>
            </details>
          </section>

          <section className="clip-studio-broll-panel" aria-labelledby="clip-broll-heading">
            <div className="section-heading-row compact">
              <div>
                <p className="kicker">Visual cutaways</p>
                <h3 id="clip-broll-heading">B-roll emphasis cards</h3>
              </div>
              <StatusBadge tone={brollLayer.enabled && brollLayer.cards.length > 0 ? "success" : "neutral"}>
                {brollLayer.enabled && brollLayer.cards.length > 0 ? `${brollLayer.cards.length} card${brollLayer.cards.length === 1 ? "" : "s"}` : "Off"}
              </StatusBadge>
            </div>

            <p className="muted small clip-studio-broll-description">
              Add a polished scripture, quote, context, or application card at the playhead. Cards are timed cutaways—not stock footage—and remain translucent so the speaker and captions stay readable.
            </p>

            <div className="clip-studio-broll-actions">
              <label className="clip-studio-toggle-row">
                <input
                  type="checkbox"
                  aria-label="Show B-roll cards"
                  checked={brollLayer.enabled}
                  onChange={(event) => setBrollLayer((current) => ({ ...current, enabled: event.target.checked }))}
                  disabled={isPending || brollLayer.cards.length === 0}
                />
                <span>
                  <strong>Show cutaway cards</strong>
                </span>
              </label>
              <button
                type="button"
                className="button secondary"
                onClick={addBrollCard}
                disabled={isPending || brollLayer.cards.length >= 4}
              >
                Add at playhead
              </button>
            </div>

            {brollLayer.cards.length > 0 ? (
              <div className="clip-studio-broll-list">
                {brollLayer.cards.map((card, index) => (
                  <article className="clip-studio-broll-card" key={card.id}>
                    <div className="clip-studio-broll-card-head">
                      <label className="clip-studio-toggle-row compact">
                        <input
                          type="checkbox"
                          aria-label={`Enable visual card ${index + 1}`}
                          checked={card.enabled}
                          onChange={(event) => updateBrollCard(card.id, { enabled: event.target.checked })}
                          disabled={isPending || !brollLayer.enabled}
                        />
                        <span>
                          <strong>Cutaway {index + 1} · {formatSecondsForPastorView(card.startSeconds)}</strong>
                        </span>
                      </label>
                      <button
                        type="button"
                        className="button secondary"
                        onClick={() => removeBrollCard(card.id)}
                        disabled={isPending}
                      >
                        Delete
                      </button>
                    </div>

                    <label className="stack-sm">
                      Text
                      <textarea
                        className="clip-studio-caption-textarea"
                        value={card.text}
                        onChange={(event) => updateBrollCard(card.id, { text: event.target.value })}
                        maxLength={140}
                        rows={3}
                        disabled={isPending || !brollLayer.enabled || !card.enabled}
                      />
                      <span className="muted small">{card.text.length}/140 · keep this to one memorable thought</span>
                    </label>

                    <div className="clip-studio-broll-grid">
                      <label className="stack-sm">
                        Label
                        <input
                          value={card.label}
                          onChange={(event) => updateBrollCard(card.id, { label: event.target.value })}
                          disabled={isPending || !brollLayer.enabled || !card.enabled}
                        />
                      </label>
                      <label className="stack-sm">
                        Starts
                        <input
                          type="number"
                          min={0}
                          step={0.1}
                          value={card.startSeconds}
                          onChange={(event) => updateBrollCard(card.id, { startSeconds: Number(event.target.value) })}
                          disabled={isPending || !brollLayer.enabled || !card.enabled}
                        />
                      </label>
                      <label className="stack-sm">
                        Duration
                        <input
                          type="number"
                          min={1}
                          max={12}
                          step={0.5}
                          value={card.durationSeconds}
                          onChange={(event) => updateBrollCard(card.id, { durationSeconds: Number(event.target.value) })}
                          disabled={isPending || !brollLayer.enabled || !card.enabled}
                        />
                      </label>
                      <label className="stack-sm">
                        Tone
                        <select
                          value={card.tone}
                          onChange={(event) => updateBrollCard(card.id, { tone: event.target.value as BrollCardTone })}
                          disabled={isPending || !brollLayer.enabled || !card.enabled}
                        >
                          {BROLL_TONE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                      <label className="stack-sm">
                        Placement
                        <select
                          value={card.position}
                          onChange={(event) => updateBrollCard(card.id, { position: event.target.value as BrollCardPosition })}
                          disabled={isPending || !brollLayer.enabled || !card.enabled}
                        >
                          {BROLL_POSITION_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="clip-studio-broll-empty">
                <button type="button" className="button secondary" onClick={addBrollCard} disabled={isPending}>
                  Add first cutaway
                </button>
              </div>
            )}
          </section>
        </div>
      </SectionCard>

      <details className="clip-studio-guidance-details">
        <summary>
          <span>Caption guidance</span>
          {captionQualityScore !== null ? (
            <StatusBadge tone={captionQualityScore >= 0.8 ? "success" : captionQualityScore >= 0.5 ? "accent" : "warning"}>
              {Math.round(captionQualityScore * 100)}%
            </StatusBadge>
          ) : null}
        </summary>
        <div className="stack-sm">
          <p className="muted small">
            Caption was manually edited. Re-analyze if you want updated AI feedback.
          </p>

          {captionQualityReason ? <p className="muted small">{captionQualityReason}</p> : null}

          {captionWarnings.length > 0 ? (
            <ul className="warning-list">
              {captionWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}

          {translationUncertainty ? (
            <p className="muted small">Translation note: {translationUncertainty}</p>
          ) : null}

          {captionImprovementSuggestions.length > 0 ? (
            <ul className="warning-list">
              {captionImprovementSuggestions.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </details>

      <div className="clip-studio-save-strip">
        <div>
          <p className="muted small">Studio draft</p>
          <p className="clip-studio-save-title">
            {isDraftDirty ? "Unsaved draft" : "Saved settings"}
          </p>
        </div>

        <div className="clip-studio-history-actions" aria-label="Draft history controls">
          <button
            type="button"
            className="button secondary"
            onClick={undoDraftChange}
            disabled={!canUndoDraft}
            title="Undo draft change"
            aria-label="Undo draft change"
          >
            Undo
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={redoDraftChange}
            disabled={!canRedoDraft}
            title="Redo draft change"
            aria-label="Redo draft change"
          >
            Redo
          </button>
        </div>

        {statusMessage ? (
          <p className={statusSuccess ? "success-banner" : "error-banner"} role="status" aria-live="polite">
            {statusMessage}
          </p>
        ) : null}
      </div>
    </section>
  );
}
