"use client";

import { type MouseEvent, useEffect, useMemo, useState } from "react";

import { SectionCard, StatusBadge } from "@/components/ui";
import { formatSecondsForPastorView, formatSecondsForTimestampInput } from "@/lib/sermonSegment";
import {
  type EditableCaptionCue,
  hashtagsToEditorInput,
  validateClipStudioTiming,
} from "@/lib/clipStudioEditing";
import { CAPTION_STYLE_PRESETS, resolveCaptionStylePreset } from "@/lib/captionStylePresets";
import type { HookOverlayConfig, SpeechCleanupSettings } from "@/lib/clipStudio";
import { buildSpeechCleanupPreviewPlan } from "@/lib/clipStudioPreviewTimeline";
import { useClipStudioPreview } from "@/app/sermons/[id]/clips/[clipId]/studio/clip-studio-preview-context";

type ClipStudioEditorProps = {
  initialStartTimeSeconds: number;
  initialEndTimeSeconds: number;
  initialShortCaption: string;
  initialPlatformCaption: string;
  initialHashtags: string[];
  initialCaptionCues: EditableCaptionCue[];
  initialApplyCaptionsToClip: boolean;
  initialCaptionStylePresetId: string;
  brandCaptionStylePresetId: string;
  suggestedHook: string;
  initialHookOverlay: HookOverlayConfig;
  initialSpeechCleanup: SpeechCleanupSettings;
  transcriptSegments: Array<{
    id: string;
    startTimeSeconds: number;
    endTimeSeconds: number;
    text: string;
  }>;
  knownDurationSeconds: number | null;
  captionQualityScore: number | null;
  captionQualityReason: string | null;
  captionWarnings: string[];
  translationUncertainty: string | null;
  captionImprovementSuggestions: string[];
};

type TranscriptSegmentOption = ClipStudioEditorProps["transcriptSegments"][number];

const QUICK_CLIP_LENGTH_SECONDS = [30, 45, 60, 90];

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

export function ClipStudioEditor({
  initialStartTimeSeconds,
  initialEndTimeSeconds,
  initialShortCaption,
  initialPlatformCaption,
  initialHashtags,
  initialCaptionCues,
  initialApplyCaptionsToClip,
  initialCaptionStylePresetId,
  brandCaptionStylePresetId,
  suggestedHook,
  initialHookOverlay,
  initialSpeechCleanup,
  transcriptSegments,
  knownDurationSeconds,
  captionQualityScore,
  captionQualityReason,
  captionWarnings,
  translationUncertainty,
  captionImprovementSuggestions,
}: ClipStudioEditorProps) {
  const { previewClock, seekPreviewTo, updateEditPreview } = useClipStudioPreview();
  const isPending = false;
  const [statusMessage, setStatusMessage] = useState("");
  const [statusSuccess, setStatusSuccess] = useState(true);

  const [startTimestamp, setStartTimestamp] = useState(
    formatSecondsForTimestampInput(initialStartTimeSeconds),
  );
  const [endTimestamp, setEndTimestamp] = useState(
    formatSecondsForTimestampInput(initialEndTimeSeconds),
  );
  const shortCaption = initialShortCaption;
  const platformCaption = initialPlatformCaption;
  const hashtags = hashtagsToEditorInput(initialHashtags);
  const [captionCues, setCaptionCues] = useState<EditableCaptionCue[]>(initialCaptionCues);
  const [applyCaptionsToClip, setApplyCaptionsToClip] = useState(initialApplyCaptionsToClip);
  const [captionStylePresetId, setCaptionStylePresetId] = useState(initialCaptionStylePresetId);
  const [hookOverlay, setHookOverlay] = useState<HookOverlayConfig>(initialHookOverlay);
  const [speechCleanup, setSpeechCleanup] = useState<SpeechCleanupSettings>(initialSpeechCleanup);
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
  const onVideoCaptionText = captionCues.map((cue) => cue.text.trim()).filter(Boolean).join(" ");
  const captionLineLabel = `${captionCues.length} ${captionCues.length === 1 ? "line" : "lines"}`;
  const captionDropdownPreview = onVideoCaptionText || "No on-video caption text yet.";

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
  } = timingPreview.fieldErrors;

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

    const absoluteSeconds = timingPreview.startSeconds + previewClock.currentSeconds;
    if (absoluteSeconds < localTimeline.start || absoluteSeconds > localTimeline.end) {
      return null;
    }

    return {
      absoluteSeconds,
      percent: clampSeconds(((absoluteSeconds - localTimeline.start) / localTimeline.duration) * 100, 0, 100),
      label: formatSecondsForPastorView(absoluteSeconds),
    };
  }, [localTimeline.duration, localTimeline.end, localTimeline.start, previewClock.currentSeconds, timingPreview.startSeconds]);
  const speechCleanupPreviewPlan = useMemo(
    () =>
      buildSpeechCleanupPreviewPlan({
        captionCues,
        durationSeconds: timingPreview.durationSeconds,
        speechCleanup,
      }),
    [captionCues, speechCleanup, timingPreview.durationSeconds],
  );
  const deadAirCutMarkers = useMemo(() => {
    if (!speechCleanupPreviewPlan.enabled || timingPreview.startSeconds === null) {
      return [];
    }

    const selectedStartSeconds = timingPreview.startSeconds;
    return speechCleanupPreviewPlan.cuts.flatMap((cut, index) => {
      const absoluteStart = selectedStartSeconds + cut.startSeconds;
      const absoluteEnd = selectedStartSeconds + cut.endSeconds;
      if (absoluteEnd < localTimeline.start || absoluteStart > localTimeline.end) {
        return [];
      }

      const leftPercent = clampSeconds(((absoluteStart - localTimeline.start) / localTimeline.duration) * 100, 0, 100);
      const rightPercent = clampSeconds(((absoluteEnd - localTimeline.start) / localTimeline.duration) * 100, 0, 100);
      return [{
        id: `${index}-${cut.startSeconds}-${cut.endSeconds}`,
        leftPercent,
        widthPercent: Math.max(0.6, rightPercent - leftPercent),
        label: `${formatSecondsForPastorView(cut.removedSeconds)} removed`,
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
      mainCaption: onVideoCaptionText,
      shortCaption,
      platformCaption,
      onVideoCaptionText,
      captionCues,
      applyCaptionsToClip,
      captionStylePresetId: resolvedCaptionStyle.id,
      hookOverlay,
      speechCleanup,
      hashtags,
      isTimingValid: timingPreview.isValid,
    }),
    [
      durationLabel,
      endTimestamp,
      captionCues,
      hashtags,
      onVideoCaptionText,
      applyCaptionsToClip,
      platformCaption,
      resolvedCaptionStyle.id,
      shortCaption,
      startTimestamp,
      hookOverlay,
      speechCleanup,
      timingPreview.durationSeconds,
      timingPreview.endSeconds,
      timingPreview.isValid,
      timingPreview.startSeconds,
    ],
  );

  useEffect(() => {
    updateEditPreview(editPreview);
  }, [editPreview, updateEditPreview]);

  function clearFeedback() {
    setStatusMessage("");
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

    seekPreviewTo(Math.max(0, absoluteSeconds - timingPreview.startSeconds));
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
    setEndTimestamp(formatSecondsForTimestampInput(lastSegment?.endTimeSeconds ?? nextEnd));
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

  function updateCaptionCue(index: number, patch: Partial<EditableCaptionCue>) {
    setCaptionCues((current) =>
      current.map((cue, cueIndex) => cueIndex === index ? { ...cue, ...patch } : cue),
    );
  }

  function addCaptionCue() {
    const lastCue = captionCues.at(-1);
    const startSeconds = lastCue ? lastCue.endSeconds : 0;
    const endSeconds = startSeconds + 3;
    setCaptionCues((current) => [
      ...current,
      {
        index: current.length + 1,
        startSeconds,
        endSeconds,
        text: "",
      },
    ]);
  }

  function removeCaptionCue(index: number) {
    setCaptionCues((current) =>
      current
        .filter((_, cueIndex) => cueIndex !== index)
        .map((cue, cueIndex) => ({ ...cue, index: cueIndex + 1 })),
    );
  }

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

  const speechCleanupRemovedSeconds = speechCleanupPreviewPlan.cuts.reduce((total, cut) => total + cut.removedSeconds, 0);
  const speechCleanupSummary = speechCleanupPreviewPlan.enabled
    ? `${speechCleanupPreviewPlan.cuts.length} pause${speechCleanupPreviewPlan.cuts.length === 1 ? "" : "s"} marked · ${formatSecondsForPastorView(
        speechCleanupRemovedSeconds,
      )} saved`
    : "Natural pacing kept";
  const hookCaptionWarning =
    hookOverlay.enabled && applyCaptionsToClip && hookOverlay.position === "lower"
      ? "Hook and captions can compete in the lower safe area. Move the hook higher before preparing."
      : null;

  return (
    <section className="stack-lg">
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

        <details className="clip-studio-editor-disclosure">
          <summary>
            <span>Advanced timing</span>
            <span className="muted small">Timeline, transcript trim, nudges</span>
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
                  className="clip-studio-timeline-dead-air"
                  style={{ left: `${cut.leftPercent}%`, width: `${cut.widthPercent}%` }}
                  title={cut.label}
                />
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

      <details className="clip-studio-editor-disclosure" open>
        <summary>
          <span>Audio</span>
          <span className="muted small">Polish</span>
        </summary>
      <SectionCard title="Audio" description="Polish speech pacing without changing the original sermon clip.">
        <div className="stack-md">
          <div className="clip-studio-effect-note">
            <StatusBadge tone="success">Live preview</StatusBadge>
            <p>The preview skips dead air and long transcript gaps immediately. Prepare when the pacing feels right.</p>
          </div>
          <p className="status-help">{speechCleanupSummary}</p>
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
              <small>Preview playback skips quiet transcript gaps now; render uses audio silence detection for the prepared video.</small>
            </span>
          </label>

          <label className="clip-studio-toggle-row">
            <input
              type="checkbox"
              aria-label="Flag filler words"
              checked={speechCleanup.flagFillerWords}
              onChange={(event) =>
                setSpeechCleanup((current) => ({
                  ...current,
                  flagFillerWords: event.target.checked,
                }))
              }
              disabled={isPending}
            />
            <span>
              <strong>Flag filler words</strong>
              <small>Detects repeated filler words for review. Automatic word removal needs word-level timestamps.</small>
            </span>
          </label>

          <div className="clip-studio-boundary-readout">
            <article>
              <span className="kicker">Preview duration</span>
              <strong>
                {speechCleanupPreviewPlan.enabled
                  ? formatSecondsForPastorView(speechCleanupPreviewPlan.cleanedDurationSeconds)
                  : durationLabel}
              </strong>
              <p className="muted small">
                The final video uses this same audio setting.
              </p>
            </article>
            <article>
              <span className="kicker">Dead air</span>
              <strong>{speechCleanup.removeDeadAir ? "Will remove" : "Kept"}</strong>
              <p className="muted small">Start/end silence is only trimmed when this is enabled.</p>
            </article>
            <article>
              <span className="kicker">Long pauses</span>
              <strong>{speechCleanup.tightenLongPauses ? `${speechCleanupPreviewPlan.cuts.length} marked` : "Kept"}</strong>
              <p className="muted small">Clear internal silent gaps collapse while leaving a natural breath.</p>
            </article>
          </div>
        </div>
      </SectionCard>
      </details>

      <SectionCard title="On-video captions & hook" description="Edit what appears on the prepared clip.">
        <div className="stack-md clip-studio-caption-form">
          <div className="clip-studio-effect-note">
            <StatusBadge tone="success">Live preview</StatusBadge>
            <p>Caption visibility, text, style, and hook changes update the preview immediately.</p>
          </div>
          <div className="clip-studio-effect-note is-transcript-source">
            <StatusBadge tone="accent">Transcript</StatusBadge>
            <p>On-video captions are built from the sermon transcription. When captions are on, they override the branding lower-third so the words stay readable.</p>
          </div>
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
              <small>Uses the sermon transcript and timing.</small>
            </span>
          </label>

          <details className="clip-studio-caption-dropdown">
            <summary>
              <span className="clip-studio-caption-dropdown-copy">
                <span className="kicker">Caption lines</span>
                <strong>{captionLineLabel}</strong>
                <span className="clip-studio-caption-dropdown-preview">{captionDropdownPreview}</span>
              </span>
              <span className="clip-studio-caption-dropdown-meta">
                <StatusBadge tone={applyCaptionsToClip ? "success" : "neutral"}>
                  {applyCaptionsToClip ? "On" : "Off"}
                </StatusBadge>
                <span aria-hidden="true" className="clip-studio-caption-dropdown-chevron">v</span>
              </span>
            </summary>

            <div className="clip-studio-caption-dropdown-body">
              <div className="clip-studio-caption-cue-list">
                {captionCues.map((cue, index) => (
                  <div className="clip-studio-caption-cue" key={`${cue.index}-${index}`}>
                    <div className="clip-studio-caption-cue-times">
                      <label className="stack-sm">
                        Start
                        <input
                          type="number"
                          min={0}
                          step={0.1}
                          value={cue.startSeconds}
                          onChange={(event) => updateCaptionCue(index, { startSeconds: Number(event.target.value) })}
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
                          onChange={(event) => updateCaptionCue(index, { endSeconds: Number(event.target.value) })}
                          disabled={isPending || !applyCaptionsToClip}
                        />
                      </label>
                    </div>
                    <label className="stack-sm clip-studio-caption-cue-text">
                      Caption {index + 1}
                      <textarea
                        className="clip-studio-caption-textarea"
                        value={cue.text}
                        onChange={(event) => updateCaptionCue(index, { text: event.target.value })}
                        disabled={isPending || !applyCaptionsToClip}
                      />
                    </label>
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => removeCaptionCue(index)}
                      disabled={isPending || captionCues.length <= 1}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              {fieldErrors?.captionCues ? (
                <span className="error-text small">{fieldErrors.captionCues}</span>
              ) : null}

              <button type="button" className="button secondary" onClick={addCaptionCue} disabled={isPending || !applyCaptionsToClip}>
                Add caption line
              </button>
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

            <details className="clip-studio-editor-disclosure compact">
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
            {suggestedHook.trim() ? (
              <button type="button" className="button secondary" onClick={useSuggestedHook} disabled={isPending}>
                Use suggested hook
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
          <p className="clip-studio-save-title">Preview updated</p>
          <p className="muted small">Prepare for Posting saves this composition and renders the final video.</p>
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
