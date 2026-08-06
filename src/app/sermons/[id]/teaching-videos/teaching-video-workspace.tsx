"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { formatTeachingVideoTime } from "@/lib/teachingVideos";
import {
  exportTeachingVideosAction,
  generateTeachingVideosAction,
  setTeachingVideoStatusAction,
  updateTeachingVideoAction,
  type TeachingVideoActionState,
} from "@/server/actions/teachingVideos";
import styles from "./teaching-videos.module.css";

type TeachingVideoItem = {
  id: string;
  title: string;
  aiTitle: string;
  teachingType: string;
  status: "SUGGESTED" | "NEEDS_REVIEW" | "APPROVED" | "REJECTED";
  startTimeSeconds: number;
  endTimeSeconds: number;
  durationSeconds: number;
  suggestedStartSeconds: number;
  suggestedEndSeconds: number;
  startAnchorId: string;
  endAnchorId: string;
  boundaryQuality: "GOOD" | "NEEDS_REVIEW" | "BLOCKED";
  standaloneScore: number;
  boundaryConfidence: number;
  titleEvidence: string | null;
  startReason: string;
  endReason: string;
  durationExceptionReason: string | null;
  contextDependencies: string[];
  riskFlags: string[];
  completeness: Record<string, boolean>;
  transcriptExcerpt: string;
  revisionVersion: number;
  approvedRevisionVersion: number | null;
  latestExport: {
    id: string;
    status: "QUEUED" | "EXPORTING" | "COMPLETED" | "FAILED" | "STALE";
    durationSeconds: number | null;
    errorMessage: string | null;
    generatedAt: string | null;
  } | null;
};

type Props = {
  sermon: {
    id: string;
    title: string;
    speakerName: string;
    language: string;
    sourceDurationSeconds: number | null;
    transcriptReady: boolean;
  };
  sourcePreviewAvailable: boolean;
  transcriptSegments: Array<{
    startTimeSeconds: number;
    endTimeSeconds: number;
    text: string;
    speakerLabel: string | null;
    confidence: number | null;
  }>;
  teachingVideos: TeachingVideoItem[];
  latestRun: {
    id: string;
    status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
    errorMessage: string | null;
    createdAt: string;
    completedAt: string | null;
  } | null;
  jobs: Array<{
    id: string;
    type: "GENERATE_TEACHING_VIDEOS" | "EXPORT_TEACHING_VIDEOS";
    status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
    errorMessage: string | null;
    createdAt: string;
    completedAt: string | null;
  }>;
};

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function prettyType(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusLabel(value: TeachingVideoItem["status"]): string {
  if (value === "NEEDS_REVIEW") return "Needs review";
  return value[0] + value.slice(1).toLowerCase();
}

export function TeachingVideoWorkspace({
  sermon,
  sourcePreviewAvailable,
  transcriptSegments,
  teachingVideos,
  latestRun,
  jobs,
}: Props) {
  const router = useRouter();
  const playerRef = useRef<HTMLVideoElement>(null);
  const [selectedId, setSelectedId] = useState(
    teachingVideos.find((video) => video.status !== "REJECTED")?.id
      ?? teachingVideos[0]?.id
      ?? "",
  );
  const selected = teachingVideos.find((video) => video.id === selectedId)
    ?? teachingVideos[0]
    ?? null;
  const [title, setTitle] = useState(selected?.title ?? "");
  const [startSeconds, setStartSeconds] = useState(selected?.startTimeSeconds ?? 0);
  const [endSeconds, setEndSeconds] = useState(selected?.endTimeSeconds ?? 0);
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);
  const [isPending, startTransition] = useTransition();
  const activeJob = jobs.find((job) => job.status === "PENDING" || job.status === "RUNNING");

  useEffect(() => {
    if (!activeJob) return;
    const timer = window.setInterval(() => router.refresh(), 4_000);
    return () => window.clearInterval(timer);
  }, [activeJob, router]);

  const contextSegments = useMemo(() => {
    if (!selected) return [];
    return transcriptSegments.filter((segment) => (
      segment.endTimeSeconds >= Math.max(0, startSeconds - 60)
      && segment.startTimeSeconds <= endSeconds + 60
    ));
  }, [endSeconds, selected, startSeconds, transcriptSegments]);

  const approvedIds = teachingVideos
    .filter((video) => (
      video.status === "APPROVED"
      && video.approvedRevisionVersion === video.revisionVersion
    ))
    .map((video) => video.id);

  function runAction(
    action: () => Promise<TeachingVideoActionState>,
    onSuccess?: (result: TeachingVideoActionState) => void,
  ) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      setMessage(result.message);
      setMessageIsError(!result.success);
      if (result.success) {
        onSuccess?.(result);
        router.refresh();
      }
    });
  }

  function seek(seconds: number) {
    if (!playerRef.current) return;
    playerRef.current.currentTime = Math.max(0, seconds);
    void playerRef.current.play().catch(() => undefined);
  }

  function selectCandidate(video: TeachingVideoItem) {
    setSelectedId(video.id);
    setTitle(video.title);
    setStartSeconds(video.startTimeSeconds);
    setEndSeconds(video.endTimeSeconds);
    if (playerRef.current) playerRef.current.currentTime = video.startTimeSeconds;
  }

  return (
    <div className={styles.workspace}>
      <header className={styles.hero}>
        <div>
          <p className={styles.kicker}>YouTube teaching videos</p>
          <h1>Find complete teachings, then cut only what was preached.</h1>
          <p>{sermon.title} · {sermon.speakerName} · {sermon.language}</p>
        </div>
        <div className={styles.heroActions}>
          <button
            className={styles.primaryButton}
            type="button"
            disabled={!sermon.transcriptReady || Boolean(activeJob) || isPending}
            onClick={() => runAction(() => generateTeachingVideosAction(
              sermon.id,
              teachingVideos.length > 0,
            ))}
          >
            {activeJob?.type === "GENERATE_TEACHING_VIDEOS"
              ? "Analysing sermon…"
              : teachingVideos.length > 0
                ? "Analyse again"
                : "Find teaching videos"}
          </button>
          <button
            className={styles.heroSecondaryButton}
            type="button"
            disabled={approvedIds.length === 0 || Boolean(activeJob) || isPending}
            onClick={() => runAction(() => exportTeachingVideosAction(sermon.id, approvedIds))}
          >
            {activeJob?.type === "EXPORT_TEACHING_VIDEOS"
              ? "Exporting…"
              : `Export approved${approvedIds.length > 0 ? ` (${approvedIds.length})` : ""}`}
          </button>
        </div>
      </header>

      {message ? (
        <div className={messageIsError ? styles.errorNotice : styles.successNotice} role="status">
          {message}
        </div>
      ) : null}
      {latestRun?.status === "FAILED" ? (
        <div className={styles.errorNotice}>
          Latest analysis failed: {latestRun.errorMessage ?? "Unknown analysis error."}
        </div>
      ) : null}
      {activeJob ? (
        <div className={styles.jobNotice} aria-live="polite">
          <span className={styles.spinner} aria-hidden="true" />
          <div>
            <strong>
              {activeJob.type === "GENERATE_TEACHING_VIDEOS"
                ? "Looking for complete teaching sections"
                : "Creating continuous source exports"}
            </strong>
            <p>The media worker is processing this in the background. This page refreshes automatically.</p>
          </div>
        </div>
      ) : null}

      {!sermon.transcriptReady ? (
        <section className={styles.emptyState}>
          <h2>Transcript required</h2>
          <p>Transcribe the sermon first so the system can identify complete teaching boundaries.</p>
        </section>
      ) : teachingVideos.length === 0 ? (
        <section className={styles.emptyState}>
          <span className={styles.emptyIcon}>T</span>
          <h2>No teaching sections have been suggested yet.</h2>
          <p>Analysis may correctly return no results when the sermon has no safely standalone section.</p>
        </section>
      ) : (
        <div className={styles.reviewGrid}>
          <aside className={styles.candidateRail} aria-label="Teaching video suggestions">
            <div className={styles.railHeading}>
              <div>
                <p className={styles.kicker}>Suggestions</p>
                <h2>{teachingVideos.length} sections</h2>
              </div>
              <span>{approvedIds.length} approved</span>
            </div>
            <div className={styles.candidateList}>
              {teachingVideos.map((video, index) => (
                <button
                  key={video.id}
                  type="button"
                  className={`${styles.candidateCard} ${video.id === selected?.id ? styles.selectedCard : ""}`}
                  onClick={() => selectCandidate(video)}
                >
                  <span className={styles.cardNumber}>{String(index + 1).padStart(2, "0")}</span>
                  <span className={styles.cardBody}>
                    <strong>{video.title}</strong>
                    <span>
                      {formatTeachingVideoTime(video.startTimeSeconds)}–{formatTeachingVideoTime(video.endTimeSeconds)}
                      {" · "}{formatTeachingVideoTime(video.durationSeconds)}
                    </span>
                    <span className={styles.cardMeta}>
                      <em data-status={video.status}>{statusLabel(video.status)}</em>
                      <span>{prettyType(video.teachingType)}</span>
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </aside>

          {selected ? (
            <section className={styles.editor}>
              <div className={styles.playerPanel}>
                {sourcePreviewAvailable ? (
                  <video
                    ref={playerRef}
                    className={styles.video}
                    controls
                    preload="metadata"
                    src={`/api/sermons/${sermon.id}/source-preview`}
                    onLoadedMetadata={() => {
                      if (playerRef.current) playerRef.current.currentTime = startSeconds;
                    }}
                    onTimeUpdate={() => {
                      if (playerRef.current && playerRef.current.currentTime >= endSeconds) {
                        playerRef.current.pause();
                      }
                    }}
                  />
                ) : (
                  <div className={styles.previewUnavailable}>
                    <strong>Source preview is on the media worker</strong>
                    <p>Open this workspace in the local app to review the original video.</p>
                  </div>
                )}
                <div className={styles.rangeSummary}>
                  <button type="button" onClick={() => seek(startSeconds)}>▶ Play selection</button>
                  <span>{formatTeachingVideoTime(startSeconds)}</span>
                  <div className={styles.rangeLine}><span /></div>
                  <span>{formatTeachingVideoTime(endSeconds)}</span>
                  <strong>{formatTeachingVideoTime(Math.max(0, endSeconds - startSeconds))}</strong>
                </div>
              </div>

              <div className={styles.editorBody}>
                <section className={styles.editPanel}>
                  <div className={styles.panelHeading}>
                    <div>
                      <p className={styles.kicker}>Selected teaching</p>
                      <h2>{selected.title}</h2>
                    </div>
                    <span data-quality={selected.boundaryQuality}>
                      {selected.boundaryQuality === "GOOD" ? "Safe boundary" : "Review boundary"}
                    </span>
                  </div>

                  <label className={styles.field}>
                    <span>Video title</span>
                    <input value={title} maxLength={100} onChange={(event) => setTitle(event.target.value)} />
                    {selected.titleEvidence ? <small>Grounded in: “{selected.titleEvidence}”</small> : null}
                  </label>

                  <div className={styles.timeFields}>
                    <label className={styles.field}>
                      <span>Start time (seconds)</span>
                      <input
                        type="number"
                        min={0}
                        max={sermon.sourceDurationSeconds ?? undefined}
                        step="0.1"
                        value={startSeconds}
                        onChange={(event) => setStartSeconds(Number(event.target.value))}
                      />
                      <button
                        type="button"
                        onClick={() => setStartSeconds(playerRef.current?.currentTime ?? startSeconds)}
                        disabled={!sourcePreviewAvailable}
                      >
                        Set at playhead
                      </button>
                    </label>
                    <label className={styles.field}>
                      <span>End time (seconds)</span>
                      <input
                        type="number"
                        min={0}
                        max={sermon.sourceDurationSeconds ?? undefined}
                        step="0.1"
                        value={endSeconds}
                        onChange={(event) => setEndSeconds(Number(event.target.value))}
                      />
                      <button
                        type="button"
                        onClick={() => setEndSeconds(playerRef.current?.currentTime ?? endSeconds)}
                        disabled={!sourcePreviewAvailable}
                      >
                        Set at playhead
                      </button>
                    </label>
                  </div>

                  <div className={styles.buttonRow}>
                    <button
                      className={styles.primaryButton}
                      type="button"
                      disabled={isPending}
                      onClick={() => runAction(
                        () => updateTeachingVideoAction({
                          teachingVideoId: selected.id,
                          expectedRevisionVersion: selected.revisionVersion,
                          title,
                          startTimeSeconds: startSeconds,
                          endTimeSeconds: endSeconds,
                        }),
                        (result) => {
                          if (!result.savedRevision) return;
                          setTitle(result.savedRevision.title);
                          setStartSeconds(result.savedRevision.startTimeSeconds);
                          setEndSeconds(result.savedRevision.endTimeSeconds);
                        },
                      )}
                    >
                      Save revision
                    </button>
                    <button
                      className={styles.textButton}
                      type="button"
                      onClick={() => {
                        setTitle(selected.aiTitle);
                        setStartSeconds(selected.suggestedStartSeconds);
                        setEndSeconds(selected.suggestedEndSeconds);
                      }}
                    >
                      Reset to AI suggestion
                    </button>
                  </div>
                </section>

                <section className={styles.evidencePanel}>
                  <div className={styles.scoreGrid}>
                    <div><span>Standalone</span><strong>{percent(selected.standaloneScore)}</strong></div>
                    <div><span>Boundary confidence</span><strong>{percent(selected.boundaryConfidence)}</strong></div>
                    <div><span>Revision</span><strong>v{selected.revisionVersion}</strong></div>
                  </div>
                  <div className={styles.reasons}>
                    <article><span>Why it starts here</span><p>{selected.startReason}</p></article>
                    <article><span>Why it ends here</span><p>{selected.endReason}</p></article>
                  </div>
                  <div className={styles.checks}>
                    {Object.entries(selected.completeness).map(([key, complete]) => (
                      <span key={key} data-complete={complete}>
                        {complete ? "✓" : "!"} {prettyType(key)}
                      </span>
                    ))}
                  </div>
                  {selected.riskFlags.length > 0 || selected.contextDependencies.length > 0 ? (
                    <div className={styles.warningBox}>
                      <strong>Reviewer attention</strong>
                      {[...selected.riskFlags, ...selected.contextDependencies].map((warning) => (
                        <span key={warning}>{prettyType(warning)}</span>
                      ))}
                    </div>
                  ) : null}
                  {selected.durationExceptionReason ? (
                    <p className={styles.durationReason}>{selected.durationExceptionReason}</p>
                  ) : null}
                  <div className={styles.reviewActions}>
                    <button
                      className={styles.approveButton}
                      type="button"
                      disabled={isPending || selected.boundaryQuality === "BLOCKED"}
                      onClick={() => runAction(() => setTeachingVideoStatusAction(selected.id, "APPROVED"))}
                    >
                      {selected.status === "APPROVED" ? "Reconfirm approval" : "Approve continuous cut"}
                    </button>
                    <button
                      className={styles.secondaryButton}
                      type="button"
                      disabled={isPending}
                      onClick={() => runAction(() => setTeachingVideoStatusAction(selected.id, "NEEDS_REVIEW"))}
                    >
                      Needs review
                    </button>
                    <button
                      className={styles.rejectButton}
                      type="button"
                      disabled={isPending}
                      onClick={() => runAction(() => setTeachingVideoStatusAction(selected.id, "REJECTED"))}
                    >
                      Reject
                    </button>
                  </div>
                  {selected.latestExport ? (
                    <div className={styles.exportState} data-export={selected.latestExport.status}>
                      <div>
                        <strong>Export {prettyType(selected.latestExport.status)}</strong>
                        {selected.latestExport.errorMessage ? <p>{selected.latestExport.errorMessage}</p> : null}
                      </div>
                      {selected.latestExport.status === "COMPLETED" ? (
                        <a
                          className={styles.downloadButton}
                          href={`/api/teaching-video-exports/${selected.latestExport.id}/download`}
                        >
                          Download MP4
                        </a>
                      ) : null}
                    </div>
                  ) : null}
                </section>
              </div>
            </section>
          ) : null}

          {selected ? (
            <aside className={styles.transcriptRail}>
              <div className={styles.railHeading}>
                <div>
                  <p className={styles.kicker}>Transcript context</p>
                  <h2>One continuous passage</h2>
                </div>
              </div>
              <div className={styles.transcriptList}>
                {contextSegments.map((segment, index) => {
                  const inSelection = (
                    segment.endTimeSeconds >= startSeconds
                    && segment.startTimeSeconds <= endSeconds
                  );
                  return (
                    <button
                      key={`${segment.startTimeSeconds}-${index}`}
                      type="button"
                      className={inSelection ? styles.selectedTranscript : styles.transcriptLine}
                      onClick={() => seek(segment.startTimeSeconds)}
                    >
                      <span>{formatTeachingVideoTime(segment.startTimeSeconds)}</span>
                      <p>{segment.text}</p>
                    </button>
                  );
                })}
              </div>
            </aside>
          ) : null}
        </div>
      )}
    </div>
  );
}
