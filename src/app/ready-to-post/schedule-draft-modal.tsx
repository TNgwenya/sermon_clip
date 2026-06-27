"use client";

import { useState } from "react";

import type { PostingAutomationMode, PostingDraft, PostingPlatform } from "@/lib/postingDrafts";

const platforms: PostingPlatform[] = ["TikTok", "Instagram", "YouTube Shorts", "Facebook"];
const postingSlots = ["Sunday recap", "Midweek encouragement", "Prayer invitation", "Weekend invite"];

function formatDateTimeLocal(date: Date): string {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return offsetDate.toISOString().slice(0, 16);
}

type ScheduleDraftModalProps = {
  clipIds: string[];
  open: boolean;
  onClose: () => void;
  onCreated: (draft: PostingDraft) => void;
};

export function ScheduleDraftModal({ clipIds, open, onClose, onCreated }: ScheduleDraftModalProps) {
  const [selectedPlatforms, setSelectedPlatforms] = useState<PostingPlatform[]>(["Instagram", "Facebook"]);
  const [automationMode, setAutomationMode] = useState<PostingAutomationMode>("AUTOMATIC");
  const [scheduledFor, setScheduledFor] = useState(() => {
    const date = new Date(Date.now() + 60 * 60_000);
    date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0);
    return formatDateTimeLocal(date);
  });
  const [timezone, setTimezone] = useState("Africa/Johannesburg");
  const [postingSlot, setPostingSlot] = useState(postingSlots[0]);
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  if (!open) {
    return null;
  }

  function togglePlatform(platform: PostingPlatform) {
    setSelectedPlatforms((current) => (
      current.includes(platform)
        ? current.filter((item) => item !== platform)
        : [...current, platform]
    ));
  }

  async function createDraft() {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/ready-to-post/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clipIds,
          platforms: selectedPlatforms,
          automationMode,
          scheduledFor: automationMode === "AUTOMATIC" ? new Date(scheduledFor).toISOString() : null,
          timezone,
          postingSlot,
          title,
          caption,
          note,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        setMessage(result.error ?? "Could not create the posting draft.");
        return;
      }
      onCreated(result.draft);
      setMessage(automationMode === "AUTOMATIC" ? "Automatic post scheduled." : "Posting draft saved for the media team.");
    } catch {
      setMessage("Could not create the posting draft.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="feature-modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="feature-modal schedule-draft-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="schedule-draft-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className="feature-modal-close" onClick={onClose} aria-label="Close">
          Close
        </button>
        <div className="stack-sm">
          <p className="kicker">Posting draft</p>
          <h2 id="schedule-draft-title">Schedule these clips</h2>
          <p className="muted">
            Create a manual handoff or an automatic posting job for the Mac worker.
          </p>
        </div>

        <div className="schedule-draft-summary">
          <span className="status-pill status-exported">{clipIds.length} clip{clipIds.length === 1 ? "" : "s"}</span>
          <span className="status-pill">{automationMode === "AUTOMATIC" ? "Mac worker" : "Media team handoff"}</span>
        </div>

        <div className="schedule-fieldset">
          <p className="small muted">Publishing mode</p>
          <div className="platform-toggle-grid">
            <label className="selection-check platform-toggle">
              <input
                type="radio"
                name="automationMode"
                checked={automationMode === "AUTOMATIC"}
                onChange={() => setAutomationMode("AUTOMATIC")}
              />
              <span>Automatic</span>
            </label>
            <label className="selection-check platform-toggle">
              <input
                type="radio"
                name="automationMode"
                checked={automationMode === "MANUAL"}
                onChange={() => setAutomationMode("MANUAL")}
              />
              <span>Manual</span>
            </label>
          </div>
        </div>

        <div className="schedule-fieldset">
          <p className="small muted">Platforms</p>
          <div className="platform-toggle-grid">
            {platforms.map((platform) => (
              <label key={platform} className="selection-check platform-toggle">
                <input
                  type="checkbox"
                  checked={selectedPlatforms.includes(platform)}
                  onChange={() => togglePlatform(platform)}
                />
                <span>{platform}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="schedule-fieldset">
          <label htmlFor="postingSlot">Posting label</label>
          <select id="postingSlot" value={postingSlot} onChange={(event) => setPostingSlot(event.target.value)}>
            {postingSlots.map((slot) => (
              <option key={slot} value={slot}>{slot}</option>
            ))}
          </select>
        </div>

        {automationMode === "AUTOMATIC" ? (
          <div className="schedule-fieldset schedule-two-column">
            <label htmlFor="scheduledFor">
              Scheduled date and time
              <input
                id="scheduledFor"
                type="datetime-local"
                value={scheduledFor}
                onChange={(event) => setScheduledFor(event.target.value)}
              />
            </label>
            <label htmlFor="timezone">
              Timezone
              <input
                id="timezone"
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
                placeholder="Africa/Johannesburg"
              />
            </label>
          </div>
        ) : null}

        <div className="schedule-fieldset">
          <label htmlFor="postTitle">Post title</label>
          <input
            id="postTitle"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Optional. The worker can use the clip title if blank."
          />
        </div>

        <div className="schedule-fieldset">
          <label htmlFor="postCaption">Caption</label>
          <textarea
            id="postCaption"
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            rows={4}
            placeholder="Optional. The worker can use the generated clip caption if blank."
          />
        </div>

        <div className="schedule-fieldset">
          <label htmlFor="draftNote">Media team note</label>
          <textarea
            id="draftNote"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            placeholder="Example: Post the prayer clip first and use the Facebook caption for the church page."
          />
        </div>

        {message ? <p className={message.includes("saved") ? "success-banner" : "error-banner"}>{message}</p> : null}

        <div className="feature-modal-footer">
          <button type="button" className="button tertiary" onClick={onClose}>
            Close
          </button>
          <button type="button" className="button primary" onClick={createDraft} disabled={pending || selectedPlatforms.length === 0}>
            {pending ? "Saving..." : automationMode === "AUTOMATIC" ? "Schedule post" : "Save posting draft"}
          </button>
        </div>
      </section>
    </div>
  );
}
