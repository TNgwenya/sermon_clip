"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

import { SectionCard, StatusBadge } from "@/components/ui";
import {
  buildNeutralCoverFrameCandidates,
  type ClipCoverFrameCandidate,
  type ClipCoverFrameSelection,
} from "@/lib/clipCoverFrame";

import styles from "./clip-studio-cover-frame.module.css";

type ClipStudioCoverFrameProps = {
  clipId: string;
  durationSeconds: number;
  initialSelection?: ClipCoverFrameSelection | null;
  localMediaAvailable?: boolean;
};

type CoverFrameStatusResponse = {
  durationSeconds?: number;
  candidates?: ClipCoverFrameCandidate[];
  selection?: ClipCoverFrameSelection | null;
  selectionStale?: boolean;
  sourceAvailable?: boolean;
};

function formatMoment(timeSeconds: number): string {
  const rounded = Math.max(0, Math.round(timeSeconds));
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function sameMoment(first: number | null, second: number | null): boolean {
  if (first === null || second === null) return first === second;
  return Math.abs(first - second) < 0.001;
}

export function ClipStudioCoverFrame({
  clipId,
  durationSeconds,
  initialSelection = null,
  localMediaAvailable = true,
}: ClipStudioCoverFrameProps) {
  const initialCandidates = useMemo(
    () => buildNeutralCoverFrameCandidates(durationSeconds),
    [durationSeconds],
  );
  const [candidates, setCandidates] = useState(initialCandidates);
  const [savedSelection, setSavedSelection] = useState(initialSelection);
  const [selectedTime, setSelectedTime] = useState<number | null>(
    initialSelection?.timeSeconds ?? initialCandidates[0]?.timeSeconds ?? null,
  );
  const [selectionStale, setSelectionStale] = useState(false);
  const [sourceAvailable, setSourceAvailable] = useState(localMediaAvailable);
  const [isLoading, setIsLoading] = useState(localMediaAvailable);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedPreviewIds, setFailedPreviewIds] = useState<Set<string>>(() => new Set());
  const [previewVersion, setPreviewVersion] = useState(initialSelection?.selectedAt ?? "initial");

  useEffect(() => {
    if (!localMediaAvailable) {
      return;
    }

    const controller = new AbortController();
    void fetch(`/api/clips/${encodeURIComponent(clipId)}/cover-frame`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Cover frame choices are temporarily unavailable.");
        return response.json() as Promise<CoverFrameStatusResponse>;
      })
      .then((payload) => {
        if (payload.candidates?.length === 4) setCandidates(payload.candidates);
        if (payload.selection) {
          setSavedSelection(payload.selection);
          setSelectedTime(payload.selection.timeSeconds);
          setPreviewVersion(payload.selection.selectedAt);
        }
        setSelectionStale(Boolean(payload.selectionStale));
        setSourceAvailable(Boolean(payload.sourceAvailable));
      })
      .catch((loadError: unknown) => {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : "Cover frame choices are temporarily unavailable.");
      })
      .finally(() => setIsLoading(false));

    return () => controller.abort();
  }, [clipId, localMediaAvailable]);

  const savedTime = savedSelection?.timeSeconds ?? null;
  const hasUnsavedChoice = !sameMoment(selectedTime, savedTime);
  const canSave = sourceAvailable && selectedTime !== null && hasUnsavedChoice && !isSaving;

  async function saveCoverFrame() {
    if (!canSave || selectedTime === null) return;
    setIsSaving(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`/api/clips/${encodeURIComponent(clipId)}/cover-frame`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeSeconds: selectedTime }),
      });
      const payload = await response.json().catch(() => ({})) as {
        error?: string;
        selection?: ClipCoverFrameSelection;
      };
      if (!response.ok || !payload.selection) {
        throw new Error(payload.error ?? "The cover frame could not be saved.");
      }

      setSavedSelection(payload.selection);
      setSelectedTime(payload.selection.timeSeconds);
      setSelectionStale(false);
      setPreviewVersion(payload.selection.selectedAt);
      setMessage("Cover frame saved. It will be used as this clip’s poster.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The cover frame could not be saved.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <SectionCard
      title="Cover frame"
      description="Choose the still image people see before the clip starts."
      className={styles.card}
    >
      <div className={styles.introRow}>
        <p className="muted small">
          These are four evenly spaced moments from the prepared clip. They are not AI-ranked.
        </p>
        {savedSelection ? (
          <StatusBadge tone={selectionStale ? "warning" : "success"}>
            {selectionStale ? "Review after clip changes" : `Saved at ${formatMoment(savedSelection.timeSeconds)}`}
          </StatusBadge>
        ) : (
          <StatusBadge tone="neutral">Not chosen yet</StatusBadge>
        )}
      </div>

      {!localMediaAvailable ? (
        <p className="warning-banner">
          Connect the local media worker to preview and choose a cover frame.
        </p>
      ) : null}

      <fieldset className={styles.fieldset} disabled={!sourceAvailable || isSaving}>
        <legend className="sr-only">Choose a cover frame moment</legend>
        <div className={styles.grid} aria-busy={isLoading}>
          {candidates.map((candidate) => {
            const isSelected = sameMoment(selectedTime, candidate.timeSeconds);
            const previewFailed = failedPreviewIds.has(candidate.id);
            const previewUrl = `/api/clips/${encodeURIComponent(clipId)}/thumbnail?at=${candidate.timeSeconds}&coverPreview=${encodeURIComponent(previewVersion)}`;

            return (
              <label
                key={`${candidate.id}-${candidate.timeSeconds}`}
                className={`${styles.option}${isSelected ? ` ${styles.selected}` : ""}`}
              >
                <input
                  className={styles.radio}
                  type="radio"
                  name={`cover-frame-${clipId}`}
                  value={candidate.timeSeconds}
                  checked={isSelected}
                  onChange={() => {
                    setSelectedTime(candidate.timeSeconds);
                    setMessage(null);
                    setError(null);
                  }}
                />
                <span className={styles.imageWrap}>
                  {previewFailed ? (
                    <span className={styles.previewFallback}>Preview unavailable</span>
                  ) : (
                    <Image
                      src={previewUrl}
                      alt={`${candidate.label} cover frame at ${formatMoment(candidate.timeSeconds)}`}
                      width={180}
                      height={320}
                      sizes="(max-width: 720px) 44vw, 150px"
                      className={styles.image}
                      unoptimized
                      onError={() => {
                        setFailedPreviewIds((current) => new Set(current).add(candidate.id));
                      }}
                    />
                  )}
                  {isSelected ? <span className={styles.check} aria-hidden="true">✓</span> : null}
                </span>
                <span className={styles.optionCopy}>
                  <strong>{candidate.label}</strong>
                  <span>{formatMoment(candidate.timeSeconds)}</span>
                  <small>{candidate.description}</small>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {!isLoading && localMediaAvailable && !sourceAvailable ? (
        <p className="warning-banner">Prepare a clip preview before choosing its cover frame.</p>
      ) : null}

      <div className={styles.actionRow}>
        <div role={error ? "alert" : "status"} aria-live="polite" className={styles.feedback}>
          {error ? <span className={styles.error}>{error}</span> : message ? <span>{message}</span> : null}
        </div>
        <button type="button" className="button primary" onClick={saveCoverFrame} disabled={!canSave}>
          {isSaving ? "Saving…" : savedSelection ? "Save new cover" : "Save cover frame"}
        </button>
      </div>
    </SectionCard>
  );
}
