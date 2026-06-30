"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { useTransition, useState } from "react";

import { EmptyState } from "@/components/ui";
import {
  generateIntelligenceAction,
  regenerateIntelligenceAction,
  regenerateMinistryMomentsAction,
  regenerateSmartClipsAction,
  regenerateSmartClipsByCategoryAction,
  refreshSubjectSpeakerTrackingAction,
  saveIntelligenceOverridesAction,
  addManualTopicAction,
  removeTopicAction,
  addManualScriptureAction,
  updateMinistryMomentReviewStatusAction,
} from "@/server/actions/sermonIntelligence";
import { MINISTRY_TOPICS } from "@/server/ai/sermonIntelligenceSchema";
import { SMART_CLIP_CATEGORIES } from "@/server/ai/ministryMomentSchema";

type IntelligenceData = {
  id: string;
  status: string;
  generatedTitle: string | null;
  summary: string | null;
  centralTheme: string | null;
  shortOverview: string | null;
  keyTakeaways: string[];
  confidenceScore: number | null;
  isManuallyReviewed: boolean;
  manualTitle: string | null;
  manualSummary: string | null;
  manualCentralTheme: string | null;
  failureReason: string | null;
  generatedAt: string | null;
};

type ScriptureRef = {
  id: string;
  reference: string;
  usageType: string;
  isPrimary: boolean;
  frequencyCount: number;
  confidenceScore: number;
  transcriptEvidence: string | null;
  isManuallyAdded: boolean;
};

type StructureSection = {
  id: string;
  sectionType: string;
  title: string | null;
  description: string | null;
  orderIndex: number;
  startTimeSeconds: number | null;
  endTimeSeconds: number | null;
  confidenceScore: number;
  transcriptExcerpt: string | null;
  isManuallyLabeled: boolean;
};

type TopicTag = {
  id: string;
  topic: string;
  confidenceScore: number;
  evidence: string | null;
  isAiGenerated: boolean;
  isManuallyAdded: boolean;
};

type MinistryMoment = {
  id: string;
  momentType: string;
  title: string;
  description: string;
  startTimeSeconds: number | null;
  endTimeSeconds: number | null;
  confidenceScore: number;
  transcriptExcerpt: string | null;
  whyDetected: string | null;
  suggestedAudience: string | null;
  suggestedUsage: string | null;
  clipCategory: string | null;
  reviewStatus: string;
  isAiGenerated: boolean;
  isManuallyAdjusted: boolean;
};

type SubjectTrack = {
  id: string;
  label: string;
  kind: string;
  evidence: string | null;
  occurrenceCount: number;
  confidenceScore: number;
  firstStartTimeSeconds: number | null;
  lastEndTimeSeconds: number | null;
};

type SpeakerTrack = {
  id: string;
  label: string;
  displayName: string;
  segmentCount: number;
  wordCount: number;
  firstStartTimeSeconds: number | null;
  lastEndTimeSeconds: number | null;
  confidenceScore: number;
  isPrimary: boolean;
};

type Props = {
  sermonId: string;
  hasTranscript: boolean;
  intelligence: IntelligenceData | null;
  scriptureRefs: ScriptureRef[];
  structureSections: StructureSection[];
  topicTags: TopicTag[];
  subjectTracks: SubjectTrack[];
  speakerTracks: SpeakerTrack[];
  ministryMoments: MinistryMoment[];
};

function formatConfidence(score: number): string {
  return `${Math.round(score * 100)}%`;
}

function formatTimestamp(seconds: number | null): string {
  if (seconds === null) return "-";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function statusBadgeStyle(status: string): CSSProperties {
  const map: Record<string, CSSProperties> = {
    COMPLETED: { color: "var(--success)", fontWeight: 700 },
    FAILED: { color: "var(--danger)", fontWeight: 700 },
    PROCESSING: { color: "var(--warning)", fontWeight: 700 },
    PENDING: { color: "var(--muted)", fontWeight: 700 },
    NEEDS_REVIEW: { color: "var(--warning)", fontWeight: 700 },
  };
  return map[status] ?? {};
}

function formatFailureReason(reason: string): string {
  if (reason.toLowerCase().includes("failed validation")) {
    return "We could not complete sermon analysis automatically. Please try Analyze Sermon again. If this keeps failing, reprocess the transcript and try once more.";
  }

  return reason;
}

function formatMomentLabel(value: string): string {
  return value.replace(/_/g, " ").toLowerCase();
}

function formatStatusLabel(value: string): string {
  return toTitleCase(value.replace(/_/g, " ").toLowerCase());
}

function toTitleCase(value: string): string {
  return value
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function GenerateButton({ sermonId, isRegenerate }: { sermonId: string; isRegenerate: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function handleClick() {
    setMessage(null);
    startTransition(async () => {
      const action = isRegenerate ? regenerateIntelligenceAction : generateIntelligenceAction;
      const result = await action(sermonId);
      setMessage(result.message);
    });
  }

  return (
    <div className="stack-sm">
      <button
        type="button"
        className={`button ${isRegenerate ? "secondary" : ""}`}
        onClick={handleClick}
        disabled={isPending}
      >
        {isPending ? (isRegenerate ? "Re-analyzing..." : "Analyzing...") : isRegenerate ? "Re-analyze Sermon" : "Analyze Sermon"}
      </button>
      {message && <p className="small muted">{message}</p>}
    </div>
  );
}

function ConfidenceDetail({ score }: { score: number }) {
  return <span>Confidence: {formatConfidence(score)}</span>;
}

function OverrideForm({ sermonId, intelligence }: { sermonId: string; intelligence: IntelligenceData }) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setMessage(null);
    startTransition(async () => {
      const result = await saveIntelligenceOverridesAction(sermonId, formData);
      setMessage(result.message);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="stack-md">
      <div className="stack-sm">
        <label htmlFor="manualTitle">Title override</label>
        <input
          id="manualTitle"
          name="manualTitle"
          type="text"
          defaultValue={intelligence.manualTitle ?? ""}
          placeholder={intelligence.generatedTitle ?? "AI-generated title"}
        />
      </div>
      <div className="stack-sm">
        <label htmlFor="manualCentralTheme">Central theme override</label>
        <input
          id="manualCentralTheme"
          name="manualCentralTheme"
          type="text"
          defaultValue={intelligence.manualCentralTheme ?? ""}
          placeholder={intelligence.centralTheme ?? "AI-detected theme"}
        />
      </div>
      <div className="stack-sm">
        <label htmlFor="manualSummary">Summary override</label>
        <textarea
          id="manualSummary"
          name="manualSummary"
          defaultValue={intelligence.manualSummary ?? ""}
          placeholder={intelligence.summary ?? "AI-generated summary"}
          rows={4}
        />
      </div>
      <div className="actions-row">
        <button type="submit" className="button secondary" disabled={isPending}>
          {isPending ? "Saving..." : "Save overrides"}
        </button>
        {message && <p className="small muted">{message}</p>}
      </div>
    </form>
  );
}

function AddTopicForm({ sermonId, existingTopics }: { sermonId: string; existingTopics: string[] }) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const available = MINISTRY_TOPICS.filter((t) => !existingTopics.includes(t));

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setMessage(null);
    startTransition(async () => {
      const result = await addManualTopicAction(sermonId, formData);
      setMessage(result.message);
    });
  }

  if (available.length === 0) {
    return <p className="small muted">All available topics have been assigned.</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="actions-row">
      <select name="topic" defaultValue="" style={{ width: "auto", minWidth: "12rem" }}>
        <option value="" disabled>Select topic...</option>
        {available.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>
      <button type="submit" className="button secondary" style={{ minWidth: "auto" }} disabled={isPending}>
        {isPending ? "Adding..." : "Add topic"}
      </button>
      {message && <p className="small muted">{message}</p>}
    </form>
  );
}

function RemoveTopicButton({ sermonId, topicId }: { sermonId: string; topicId: string }) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      await removeTopicAction(sermonId, topicId);
    });
  }

  return (
    <button type="button" className="button tertiary" style={{ padding: "0.25rem 0.6rem", minHeight: "auto", fontSize: "0.78rem" }} onClick={handleClick} disabled={isPending}>
      {isPending ? "..." : "x"}
    </button>
  );
}

function RefreshButtons({ sermonId }: { sermonId: string }) {
  const [isPending, startTransition] = useTransition();
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const [message, setMessage] = useState<string | null>(null);

  function run(action: (id: string) => Promise<{ success: boolean; message: string }>) {
    startTransition(async () => {
      setMessage(null);
      const result = await action(sermonId);
      setMessage(result.message);
    });
  }

  return (
    <div className="actions-row">
      <button type="button" className="button secondary" onClick={() => run(regenerateMinistryMomentsAction)} disabled={isPending}>
        {isPending ? "Refreshing..." : "Regenerate Ministry Moments"}
      </button>
      <button type="button" className="button secondary" onClick={() => run(regenerateSmartClipsAction)} disabled={isPending}>
        {isPending ? "Refreshing..." : "Regenerate Suggested Clips"}
      </button>
      <button type="button" className="button secondary" onClick={() => run(refreshSubjectSpeakerTrackingAction)} disabled={isPending}>
        {isPending ? "Refreshing..." : "Refresh Subject/Speaker Tracking"}
      </button>
      <select
        value={selectedCategory}
        onChange={(event) => setSelectedCategory(event.target.value)}
        disabled={isPending}
        style={{ minWidth: "14rem" }}
      >
        <option value="ALL">All Smart Clip Categories</option>
        {SMART_CLIP_CATEGORIES.map((category) => (
          <option key={category} value={category}>{category}</option>
        ))}
      </select>
      <button
        type="button"
        className="button secondary"
        disabled={isPending || selectedCategory === "ALL"}
        onClick={() => {
          if (selectedCategory === "ALL") {
            return;
          }

          startTransition(async () => {
            setMessage(null);
            const result = await regenerateSmartClipsByCategoryAction(
              sermonId,
              selectedCategory as (typeof SMART_CLIP_CATEGORIES)[number],
            );
            setMessage(result.message);
          });
        }}
      >
        {isPending ? "Refreshing..." : "Regenerate Selected Category"}
      </button>
      {message && <p className="small muted">{message}</p>}
    </div>
  );
}

function AddScriptureForm({ sermonId }: { sermonId: string }) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setMessage(null);
    startTransition(async () => {
      const result = await addManualScriptureAction(sermonId, formData);
      setMessage(result.message);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="stack-sm">
      <div className="actions-row">
        <input
          name="reference"
          type="text"
          placeholder="e.g. John 3:16"
          style={{ width: "12rem" }}
          required
        />
        <select name="usageType" style={{ width: "auto" }}>
          <option value="READ">Read aloud</option>
          <option value="QUOTED">Quoted</option>
          <option value="REFERENCED">Referenced</option>
          <option value="IMPLIED">Implied</option>
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontWeight: "normal" }}>
          <input name="isPrimary" type="checkbox" value="true" />
          Primary
        </label>
        <button type="submit" className="button secondary" style={{ minWidth: "auto" }} disabled={isPending}>
          {isPending ? "Adding..." : "Add scripture"}
        </button>
      </div>
      {message && <p className="small muted">{message}</p>}
    </form>
  );
}

function MinistryMomentReviewStatusControl({
  sermonId,
  momentId,
  currentStatus,
}: {
  sermonId: string;
  momentId: string;
  currentStatus: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [nextStatus, setNextStatus] = useState(currentStatus);

  return (
    <div className="actions-row" style={{ marginTop: "0.4rem" }}>
      <select
        value={nextStatus}
        onChange={(event) => setNextStatus(event.target.value)}
        disabled={isPending}
        style={{ width: "auto" }}
      >
        <option value="PENDING">Pending</option>
        <option value="IN_REVIEW">In Review</option>
        <option value="APPROVED">Approved</option>
        <option value="REJECTED">Rejected</option>
        <option value="NEEDS_CORRECTION">Needs Correction</option>
      </select>
      <button
        type="button"
        className="button secondary"
        disabled={isPending || nextStatus === currentStatus}
        onClick={() => {
          startTransition(async () => {
            setMessage(null);
            const result = await updateMinistryMomentReviewStatusAction(
              sermonId,
              momentId,
              nextStatus as "PENDING" | "IN_REVIEW" | "APPROVED" | "REJECTED" | "NEEDS_CORRECTION",
            );
            setMessage(result.message);
          });
        }}
      >
        {isPending ? "Updating..." : "Update Review Status"}
      </button>
      {message ? <span className="small muted">{message}</span> : null}
    </div>
  );
}

export function IntelligenceExperience({
  sermonId,
  hasTranscript,
  intelligence,
  scriptureRefs,
  structureSections,
  topicTags,
  subjectTracks,
  speakerTracks,
  ministryMoments,
}: Props) {
  const [momentTypeFilter, setMomentTypeFilter] = useState<string>("ALL");

  const visibleMinistryMoments = ministryMoments.filter((moment) => {
    if (momentTypeFilter === "ALL") {
      return true;
    }

    return moment.momentType === momentTypeFilter;
  });

  const availableMomentTypes = Array.from(new Set(ministryMoments.map((moment) => moment.momentType)));

  if (!hasTranscript) {
    return (
      <EmptyState
        title="Transcript required"
        description="Process the sermon to generate a transcript before generating intelligence."
      />
    );
  }

  if (!intelligence) {
    return (
      <div className="card stack-md">
        <p className="muted">No sermon intelligence has been generated yet.</p>
        <GenerateButton sermonId={sermonId} isRegenerate={false} />
      </div>
    );
  }

  const effectiveTitle = intelligence.manualTitle ?? intelligence.generatedTitle;
  const effectiveTheme = intelligence.manualCentralTheme ?? intelligence.centralTheme;
  const effectiveSummary = intelligence.manualSummary ?? intelligence.summary;

  return (
    <div className="stack-lg sermon-intelligence-experience">
      {intelligence.status === "COMPLETED" && (
        <>
          <nav className="sermon-intelligence-tabs" aria-label="Sermon intelligence sections">
            <a href="#summary">Summary</a>
            <a href="#moments">Moments</a>
            <a href="#scripture">Scripture</a>
            <a href="#admin">Admin</a>
          </nav>

          <div className="card stack-md sermon-intelligence-overview-card" id="summary">
            <h2>Sermon Overview</h2>
            <div className="actions-row sermon-intelligence-status-row">
              <span className="status-pill status-exported">Analyzed</span>
              {intelligence.generatedAt && (
                <span className="small muted">Generated {new Date(intelligence.generatedAt).toLocaleDateString()}</span>
              )}
              {intelligence.isManuallyReviewed && (
                <span className="small" style={{ color: "var(--accent)" }}>Manually reviewed</span>
              )}
            </div>

            <div className="stack-sm">
              <span className="kicker">Title</span>
              <p>{effectiveTitle ?? <span className="muted">-</span>}</p>
              {intelligence.manualTitle && (
                <span className="small muted">AI suggested: {intelligence.generatedTitle}</span>
              )}
            </div>

            <div className="stack-sm">
              <span className="kicker">Central Theme</span>
              <p>{effectiveTheme ?? <span className="muted">-</span>}</p>
            </div>

            <div className="stack-sm">
              <span className="kicker">Short Overview</span>
              <p className="muted">{intelligence.shortOverview}</p>
            </div>

            <div className="stack-sm">
              <span className="kicker">Summary</span>
              <p>{effectiveSummary}</p>
            </div>

            {intelligence.keyTakeaways.length > 0 && (
              <div className="stack-sm">
                <span className="kicker">Key Takeaways</span>
                <ul style={{ paddingLeft: "1.25rem" }}>
                  {intelligence.keyTakeaways.map((t, i) => (
                    <li key={i} className="small">{t}</li>
                  ))}
                </ul>
              </div>
            )}

            {intelligence.confidenceScore !== null && (
              <details className="sermon-intelligence-evidence">
                <summary>Analysis confidence</summary>
                <p className="small muted">
                  AI confidence: {formatConfidence(intelligence.confidenceScore)}
                </p>
              </details>
            )}
          </div>

          <details className="card stack-md sermon-intelligence-disclosure" id="admin">
            <summary>
              <span>
                <span className="kicker">Admin</span>
                <strong>Manual Corrections</strong>
              </span>
              <span className="small muted">Edit title, theme, or summary</span>
            </summary>
            <div className="advanced-details-body">
              <p className="small muted">Override AI-generated fields. Leave blank to keep AI values.</p>
              <OverrideForm sermonId={sermonId} intelligence={intelligence} />
            </div>
          </details>

          <div className="card stack-md" id="speakers">
            <h2>Subjects & Speakers</h2>
            <p className="small muted">
              Track the main voices and recurring sermon subjects so clips, captions, and future reframing can stay context-aware.
            </p>

            <div className="caption-preview-grid">
              <div className="caption-preview-card stack-sm">
                <span className="kicker">Main voices</span>
                {speakerTracks.length === 0 ? (
                  <p className="muted small">No speaker tracking has been prepared yet.</p>
                ) : (
                  <div className="stack-sm">
                    {speakerTracks.map((speaker) => (
                      <div key={speaker.id} className="pastor-insight">
                        <div className="actions-row">
                          <strong>{speaker.displayName}</strong>
                          {speaker.isPrimary ? <span className="status-pill status-exported">Primary speaker</span> : null}
                        </div>
                        <p className="small muted">
                          {speaker.segmentCount} segment{speaker.segmentCount === 1 ? "" : "s"} · {speaker.wordCount} words
                        </p>
                        <p className="small muted">
                          {formatTimestamp(speaker.firstStartTimeSeconds)} - {formatTimestamp(speaker.lastEndTimeSeconds)}
                        </p>
                        <details className="sermon-intelligence-evidence">
                          <summary>Details</summary>
                          <p className="small muted"><ConfidenceDetail score={speaker.confidenceScore} /></p>
                        </details>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="brand-preview-card stack-sm">
                <span className="kicker">Tracked subjects</span>
                {subjectTracks.length === 0 ? (
                  <p className="muted small">No subjects tracked yet. Refresh tracking after transcript or intelligence is available.</p>
                ) : (
                  <div className="stack-sm">
                    {subjectTracks.slice(0, 10).map((subject) => (
                      <div key={subject.id} className="pastor-insight">
                        <div className="actions-row">
                          <strong>{subject.label}</strong>
                          <span className="status-pill">{subject.kind.toLowerCase().replace(/_/g, " ")}</span>
                        </div>
                        <p className="small muted">
                          Mentioned {subject.occurrenceCount} time{subject.occurrenceCount === 1 ? "" : "s"}
                        </p>
                        {subject.firstStartTimeSeconds !== null ? (
                          <p className="small muted">
                            {formatTimestamp(subject.firstStartTimeSeconds)} - {formatTimestamp(subject.lastEndTimeSeconds)}
                          </p>
                        ) : null}
                        <details className="sermon-intelligence-evidence">
                          <summary>Evidence</summary>
                          <p className="small muted"><ConfidenceDetail score={subject.confidenceScore} /></p>
                          {subject.evidence ? <p className="small muted">&quot;{subject.evidence}&quot;</p> : null}
                        </details>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="card stack-md" id="scripture">
            <h2>Scripture References</h2>

            {scriptureRefs.length === 0 ? (
              <p className="muted small">No scriptures detected.</p>
            ) : (
              <div className="stack-sm">
                {scriptureRefs.map((ref) => (
                  <div key={ref.id} className="card" style={{ padding: "0.75rem" }}>
                    <div className="actions-row">
                      <strong>{ref.reference}</strong>
                      {ref.isPrimary && <span className="kicker">Primary</span>}
                      <span className="small muted">{ref.usageType.toLowerCase()}</span>
                      <span className="small muted">x{ref.frequencyCount}</span>
                      {ref.isManuallyAdded && <span className="small" style={{ color: "var(--accent)" }}>manual</span>}
                    </div>
                    <details className="sermon-intelligence-evidence">
                      <summary>Evidence</summary>
                      <p className="small muted"><ConfidenceDetail score={ref.confidenceScore} /></p>
                      {ref.transcriptEvidence && (
                        <p className="small muted">
                          &quot;{ref.transcriptEvidence}&quot;
                        </p>
                      )}
                    </details>
                  </div>
                ))}
              </div>
            )}

            <div className="stack-sm">
              <span className="kicker">Add Scripture</span>
              <AddScriptureForm sermonId={sermonId} />
            </div>
          </div>

          <div className="card stack-md">
            <h2>Sermon Structure</h2>

            {structureSections.length === 0 ? (
              <p className="muted small">No structure sections detected.</p>
            ) : (
              <div className="stack-sm">
                {structureSections.map((sec) => (
                  <div key={sec.id} className="card" style={{ padding: "0.75rem" }}>
                    <div className="actions-row">
                      <strong>{sec.title ?? sec.sectionType.replace(/_/g, " ").toLowerCase()}</strong>
                      <span className="small muted">{sec.sectionType}</span>
                      {sec.startTimeSeconds !== null && (
                        <span className="small muted">
                          {formatTimestamp(sec.startTimeSeconds)} - {formatTimestamp(sec.endTimeSeconds)}
                        </span>
                      )}
                      {sec.isManuallyLabeled && <span className="small" style={{ color: "var(--accent)" }}>manual</span>}
                    </div>
                    {sec.description && <p className="small muted" style={{ marginTop: "0.35rem" }}>{sec.description}</p>}
                    <details className="sermon-intelligence-evidence">
                      <summary>Evidence</summary>
                      <p className="small muted"><ConfidenceDetail score={sec.confidenceScore} /></p>
                      {sec.transcriptExcerpt && (
                        <p className="small muted" style={{ fontStyle: "italic" }}>
                          &quot;{sec.transcriptExcerpt}&quot;
                        </p>
                      )}
                    </details>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card stack-md" id="moments">
            <h2>Ministry Moments</h2>

            <div className="actions-row">
              <label className="small muted" htmlFor="momentTypeFilter">Filter type</label>
              <select
                id="momentTypeFilter"
                value={momentTypeFilter}
                onChange={(event) => setMomentTypeFilter(event.target.value)}
                style={{ width: "auto", minWidth: "14rem" }}
              >
                <option value="ALL">All moment types</option>
                {availableMomentTypes.map((momentType) => (
                  <option key={momentType} value={momentType}>
                    {toTitleCase(formatMomentLabel(momentType))}
                  </option>
                ))}
              </select>
            </div>

            {visibleMinistryMoments.length === 0 ? (
              <p className="muted small">No ministry moments detected yet.</p>
            ) : (
              <div className="stack-sm">
                {visibleMinistryMoments.map((moment) => (
                  <div key={moment.id} className="card" style={{ padding: "0.75rem" }}>
                    <div className="actions-row">
                      <strong>{moment.title}</strong>
                      <span className="small muted">{formatMomentLabel(moment.momentType)}</span>
                      {moment.clipCategory ? <span className="kicker">{moment.clipCategory}</span> : null}
                      {moment.isManuallyAdjusted ? <span className="small" style={{ color: "var(--accent)" }}>manual</span> : null}
                    </div>
                    <p className="small muted">{moment.description}</p>
                    <p className="small muted">
                      {formatTimestamp(moment.startTimeSeconds)} - {formatTimestamp(moment.endTimeSeconds)} · {moment.reviewStatus}
                    </p>
                    {moment.suggestedAudience ? <p className="small muted">Audience: {moment.suggestedAudience}</p> : null}
                    {moment.suggestedUsage ? <p className="small muted">Usage: {moment.suggestedUsage}</p> : null}
                    <div className="sermon-intelligence-moment-actions">
                      <Link href={`/sermons/${sermonId}`} className="button secondary">
                        Create clip
                      </Link>
                      <details className="sermon-intelligence-evidence">
                        <summary>Open evidence</summary>
                        <p className="small muted"><ConfidenceDetail score={moment.confidenceScore} /></p>
                        {moment.whyDetected ? <p className="small muted">Why: {moment.whyDetected}</p> : null}
                        {moment.transcriptExcerpt ? <p className="small muted">&quot;{moment.transcriptExcerpt}&quot;</p> : null}
                        <MinistryMomentReviewStatusControl
                          sermonId={sermonId}
                          momentId={moment.id}
                          currentStatus={moment.reviewStatus}
                        />
                      </details>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card stack-md">
            <h2>Topics</h2>

            {topicTags.length === 0 ? (
              <p className="muted small">No topics detected.</p>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                {topicTags.map((tag) => (
                  <div key={tag.id} style={{ display: "flex", alignItems: "center", gap: "0.3rem", background: "#ecfeff", border: "1px solid #99f6e4", borderRadius: "2rem", padding: "0.25rem 0.65rem" }}>
                    <span className="small" style={{ color: "#134e4a", fontWeight: 600 }}>{tag.topic}</span>
                    <RemoveTopicButton sermonId={sermonId} topicId={tag.id} />
                  </div>
                ))}
              </div>
            )}

            <div className="stack-sm">
              <span className="kicker">Add Topic</span>
              <AddTopicForm sermonId={sermonId} existingTopics={topicTags.map((t) => t.topic)} />
            </div>
          </div>

          <details className="card stack-md sermon-intelligence-disclosure">
            <summary>
              <span>
                <span className="kicker">Advanced</span>
                <strong>Troubleshooting and regeneration</strong>
              </span>
              <span className="small muted">Rebuild analysis, moments, clips, or tracking</span>
            </summary>
            <div className="advanced-details-body stack-md">
              <div className="actions-row">
                <span className="small" style={statusBadgeStyle(intelligence.status)}>
                  Status: {formatStatusLabel(intelligence.status)}
                </span>
                {intelligence.generatedAt && (
                  <span className="small muted">Generated: {new Date(intelligence.generatedAt).toLocaleDateString()}</span>
                )}
              </div>
              <GenerateButton sermonId={sermonId} isRegenerate />
              <RefreshButtons sermonId={sermonId} />
            </div>
          </details>
        </>
      )}
      {intelligence.status !== "COMPLETED" ? (
        <div className="card stack-md sermon-intelligence-action-card">
          <div className="actions-row">
            <span className="small" style={statusBadgeStyle(intelligence.status)}>
              Status: {formatStatusLabel(intelligence.status)}
            </span>
            {intelligence.generatedAt && (
              <span className="small muted">Generated: {new Date(intelligence.generatedAt).toLocaleDateString()}</span>
            )}
          </div>

          {intelligence.status === "FAILED" && intelligence.failureReason && (
            <div style={{ color: "var(--danger)" }} className="small">
              Error: {formatFailureReason(intelligence.failureReason)}
            </div>
          )}

          <GenerateButton sermonId={sermonId} isRegenerate={intelligence.status === "COMPLETED"} />
          <details className="sermon-intelligence-disclosure">
            <summary>
              <span>
                <span className="kicker">Advanced</span>
                <strong>Refresh generated assets</strong>
              </span>
            </summary>
            <div className="advanced-details-body">
              <RefreshButtons sermonId={sermonId} />
            </div>
          </details>
        </div>
      ) : null}
    </div>
  );
}
