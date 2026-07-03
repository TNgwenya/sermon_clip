"use client";

import { useMemo, useState } from "react";

import type { PostingAutomationMode, PostingDraft, PostingPlatform } from "@/lib/postingDrafts";
import { formatScheduleInterval, suggestScheduleIntervalMinutes, toDateTimeLocalInputValue } from "@/lib/postingSchedule";
import type { SocialAccount } from "@/lib/socialAccounts";

const platforms: PostingPlatform[] = ["TikTok", "Instagram", "YouTube Shorts", "Facebook"];
const postingSlots = ["Sunday recap", "Midweek encouragement", "Prayer invitation", "Weekend invite"];
type AccountSelectionsByPlatform = Partial<Record<PostingPlatform, string[]>>;
export type ScheduleDraftClipSummary = {
  id: string;
  title: string;
  caption: string;
};

function formatPlanTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

type ScheduleDraftModalProps = {
  clipIds: string[];
  clipDetails?: ScheduleDraftClipSummary[];
  socialAccounts?: SocialAccount[];
  initialAutomationMode?: PostingAutomationMode;
  initialPostingSlot?: string | null;
  initialScheduledFor?: string | null;
  open: boolean;
  onClose: () => void;
  onCreated: (draft: PostingDraft) => void;
};

function hasSyncedZernioAccount(accounts: SocialAccount[], platform: PostingPlatform): boolean {
  return accounts.some((account) => (
    account.platform === platform
    && account.status === "CONNECTED"
    && account.externalProvider === "zernio"
    && Boolean(account.externalAccountId)
  ));
}

function buildAutomaticPlatforms(accounts: SocialAccount[]): Set<PostingPlatform> {
  return new Set<PostingPlatform>([
    ...(hasSyncedZernioAccount(accounts, "TikTok") ? ["TikTok" as const] : []),
    ...(hasSyncedZernioAccount(accounts, "Instagram") ? ["Instagram" as const] : []),
    "YouTube Shorts",
    "Facebook",
  ]);
}

function buildDefaultAccountSelections(accounts: SocialAccount[]): AccountSelectionsByPlatform {
  return platforms.reduce((accumulator, platform) => {
    const firstAccount = accounts.find((account) => account.platform === platform);
    return firstAccount ? { ...accumulator, [platform]: [firstAccount.id] } : accumulator;
  }, {} as AccountSelectionsByPlatform);
}

function isAutomaticPublishingAccount(account: SocialAccount): boolean {
  if (account.platform !== "TikTok" && account.platform !== "Instagram") {
    return true;
  }

  return account.externalProvider === "zernio" && Boolean(account.externalAccountId);
}

function buildPlatformHint(input: {
  disabled: boolean;
  automationMode: PostingAutomationMode;
  connectedAccountCount: number;
  selectableAccountCount: number;
}): string {
  if (input.disabled) {
    return "Connect synced account";
  }

  if (input.selectableAccountCount > 0) {
    return `${input.selectableAccountCount} account${input.selectableAccountCount === 1 ? "" : "s"}`;
  }

  return input.automationMode === "AUTOMATIC" ? "Configured channel" : "Media team handoff";
}

export function ScheduleDraftModal({
  clipIds,
  clipDetails = [],
  socialAccounts = [],
  initialAutomationMode,
  initialPostingSlot,
  initialScheduledFor,
  open,
  onClose,
  onCreated,
}: ScheduleDraftModalProps) {
  const clipDetailsById = useMemo(() => new Map(clipDetails.map((clip) => [clip.id, clip])), [clipDetails]);
  const fallbackClipDetails = useMemo(() => clipIds.map((clipId, index) => ({
    id: clipId,
    title: clipDetailsById.get(clipId)?.title || `Clip ${index + 1}`,
    caption: clipDetailsById.get(clipId)?.caption || "",
  })), [clipDetailsById, clipIds]);
  const automaticPlatforms = buildAutomaticPlatforms(socialAccounts);
  const accountsByPlatform = useMemo(() => platforms.reduce((accumulator, platform) => ({
    ...accumulator,
    [platform]: socialAccounts.filter((account) => account.platform === platform && account.status === "CONNECTED"),
  }), {} as Record<PostingPlatform, SocialAccount[]>), [socialAccounts]);
  const suggestedIntervalMinutes = suggestScheduleIntervalMinutes(clipIds.length);
  const defaultAutomaticPlatform: PostingPlatform = automaticPlatforms.has("Instagram")
    ? "Instagram"
    : automaticPlatforms.has("TikTok")
      ? "TikTok"
      : "YouTube Shorts";
  const [selectedPlatforms, setSelectedPlatforms] = useState<PostingPlatform[]>([defaultAutomaticPlatform]);
  const [orderedClipIds, setOrderedClipIds] = useState(() => clipIds);
  const [clipCopyById, setClipCopyById] = useState<Record<string, { title: string; caption: string }>>(() => (
    Object.fromEntries(fallbackClipDetails.map((clip) => [clip.id, { title: clip.title, caption: clip.caption }]))
  ));
  const [selectedSocialAccountIdsByPlatform, setSelectedSocialAccountIdsByPlatform] = useState<AccountSelectionsByPlatform>(() => (
    buildDefaultAccountSelections(socialAccounts)
  ));
  const [automationMode, setAutomationMode] = useState<PostingAutomationMode>(initialAutomationMode ?? "AUTOMATIC");
  const selectableAccountsByPlatform = useMemo(() => platforms.reduce((accumulator, platform) => ({
    ...accumulator,
    [platform]: accountsByPlatform[platform].filter((account) => (
      automationMode === "MANUAL" || isAutomaticPublishingAccount(account)
    )),
  }), {} as Record<PostingPlatform, SocialAccount[]>), [accountsByPlatform, automationMode]);
  const [scheduledFor, setScheduledFor] = useState(() => {
    const date = new Date(Date.now() + 60 * 60_000);
    date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0);
    return initialScheduledFor?.trim() || toDateTimeLocalInputValue(date);
  });
  const [customScheduleIntervalMinutes, setCustomScheduleIntervalMinutes] = useState<number | null>(null);
  const [timezone, setTimezone] = useState("Africa/Johannesburg");
  const postingSlotOptions = useMemo(() => (
    Array.from(new Set([
      initialPostingSlot?.trim(),
      ...postingSlots,
    ].filter((slot): slot is string => Boolean(slot && slot.length > 0))))
  ), [initialPostingSlot]);
  const [postingSlot, setPostingSlot] = useState(postingSlotOptions[0] ?? postingSlots[0]);
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const intervalOptions = useMemo(() => {
    const options = [
      suggestedIntervalMinutes,
      2 * 60,
      4 * 60,
      6 * 60,
      24 * 60,
    ].filter((minutes) => minutes > 0);

    return Array.from(new Set(options));
  }, [suggestedIntervalMinutes]);
  const resolvedSocialAccountIdsByPlatform = useMemo(() => platforms.reduce((accumulator, platform) => {
    const platformAccounts = selectableAccountsByPlatform[platform];
    if (platformAccounts.length === 0) {
      return accumulator;
    }

    const availableIds = new Set(platformAccounts.map((account) => account.id));
    const selectedIds = selectedSocialAccountIdsByPlatform[platform];
    if (selectedIds) {
      const availableSelectedIds = selectedIds.filter((accountId) => availableIds.has(accountId));
      if (availableSelectedIds.length > 0 || selectedIds.length === 0) {
        return { ...accumulator, [platform]: availableSelectedIds };
      }
    }

    return { ...accumulator, [platform]: [platformAccounts[0].id] };
  }, {} as AccountSelectionsByPlatform), [selectableAccountsByPlatform, selectedSocialAccountIdsByPlatform]);
  const scheduleIntervalMinutes = customScheduleIntervalMinutes ?? suggestedIntervalMinutes;
  const hasMissingAccountSelection = selectedPlatforms.some((platform) => (
    selectableAccountsByPlatform[platform].length > 0
    && (resolvedSocialAccountIdsByPlatform[platform]?.length ?? 0) === 0
  ));
  const schedulePreview = useMemo(() => {
    const start = new Date(scheduledFor);
    if (automationMode !== "AUTOMATIC" || Number.isNaN(start.getTime())) {
      return [];
    }

    const interval = orderedClipIds.length > 1 ? scheduleIntervalMinutes : 0;
    return orderedClipIds.slice(0, 8).map((clipId, index) => ({
      clipId,
      label: clipCopyById[clipId]?.title || clipDetailsById.get(clipId)?.title || `Clip ${index + 1}`,
      scheduledFor: new Date(start.getTime() + index * interval * 60_000),
    }));
  }, [automationMode, clipCopyById, clipDetailsById, orderedClipIds, scheduleIntervalMinutes, scheduledFor]);

  if (!open) {
    return null;
  }

  function togglePlatform(platform: PostingPlatform) {
    if (automationMode === "AUTOMATIC" && !automaticPlatforms.has(platform)) {
      return;
    }

    setSelectedPlatforms((current) => (
      current.includes(platform)
        ? current.filter((item) => item !== platform)
        : [...current, platform]
    ));
  }

  function toggleSocialAccount(platform: PostingPlatform, accountId: string) {
    setSelectedSocialAccountIdsByPlatform((current) => {
      const currentIds = resolvedSocialAccountIdsByPlatform[platform] ?? [];
      const nextIds = currentIds.includes(accountId)
        ? currentIds.filter((item) => item !== accountId)
        : [...currentIds, accountId];

      return {
        ...current,
        [platform]: nextIds,
      };
    });
  }

  function changeAutomationMode(mode: PostingAutomationMode) {
    setAutomationMode(mode);
    if (mode === "AUTOMATIC") {
      setSelectedPlatforms((current) => {
        const supported = current.filter((platform) => automaticPlatforms.has(platform));
        return supported.length > 0 ? supported : ["YouTube Shorts"];
      });
    }
  }

  function updateClipOrder(clipId: string, orderValue: string) {
    const nextOrder = Math.max(1, Math.min(orderedClipIds.length, Math.round(Number(orderValue) || 1)));
    setOrderedClipIds((current) => {
      const withoutClip = current.filter((item) => item !== clipId);
      withoutClip.splice(nextOrder - 1, 0, clipId);
      return withoutClip;
    });
  }

  function moveClip(clipId: string, direction: -1 | 1) {
    setOrderedClipIds((current) => {
      const index = current.indexOf(clipId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) {
        return current;
      }

      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  }

  function updateClipCopy(clipId: string, field: "title" | "caption", value: string) {
    setClipCopyById((current) => ({
      ...current,
      [clipId]: {
        title: current[clipId]?.title ?? clipDetailsById.get(clipId)?.title ?? "",
        caption: current[clipId]?.caption ?? clipDetailsById.get(clipId)?.caption ?? "",
        [field]: value,
      },
    }));
  }

  async function createDraft() {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/ready-to-post/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clipIds: orderedClipIds,
          platforms: selectedPlatforms,
          socialAccountIdsByPlatform: selectedPlatforms.reduce((accumulator, platform) => {
            const accountIds = resolvedSocialAccountIdsByPlatform[platform]?.filter(Boolean) ?? [];
            return accountIds.length > 0 ? { ...accumulator, [platform]: accountIds } : accumulator;
          }, {} as AccountSelectionsByPlatform),
          automationMode,
          scheduledFor: automationMode === "AUTOMATIC" ? new Date(scheduledFor).toISOString() : null,
          timezone,
          postingSlot,
          title,
          caption,
          note,
          scheduleIntervalMinutes: orderedClipIds.length > 1 ? scheduleIntervalMinutes : 0,
          clipCopyById: orderedClipIds.reduce((accumulator, clipId) => {
            const copy = clipCopyById[clipId];
            return copy ? { ...accumulator, [clipId]: copy } : accumulator;
          }, {} as Record<string, { title: string; caption: string }>),
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        setMessage(result.error ?? "Could not create the posting draft.");
        return;
      }
      onCreated(result.draft);
      setMessage(automationMode === "AUTOMATIC" ? "Automatic posting plan scheduled." : "Posting draft saved for the media team.");
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
          <p className="kicker">Publishing</p>
          <h2 id="schedule-draft-title">Schedule post</h2>
        </div>

        <div className="schedule-draft-summary">
          <span className="status-pill status-exported">{orderedClipIds.length} clip{orderedClipIds.length === 1 ? "" : "s"}</span>
          <span className="status-pill">{automationMode === "AUTOMATIC" ? "Automatic posting" : "Media team handoff"}</span>
          {automationMode === "AUTOMATIC" && orderedClipIds.length > 1 ? (
            <span className="status-pill">Every {formatScheduleInterval(scheduleIntervalMinutes)}</span>
          ) : null}
        </div>

        <div className="schedule-fieldset">
          <p className="small muted">Publishing mode</p>
          <div className="platform-toggle-grid">
            <label className="selection-check platform-toggle">
              <input
                type="radio"
                name="automationMode"
                checked={automationMode === "AUTOMATIC"}
                onChange={() => changeAutomationMode("AUTOMATIC")}
              />
              <span>Automatic</span>
            </label>
            <label className="selection-check platform-toggle">
              <input
                type="radio"
                name="automationMode"
                checked={automationMode === "MANUAL"}
                onChange={() => changeAutomationMode("MANUAL")}
              />
              <span>Manual</span>
            </label>
          </div>
        </div>

        <div className="schedule-fieldset">
          <p className="small muted">Platforms</p>
          <div className="platform-toggle-grid">
            {platforms.map((platform) => {
              const disabled = automationMode === "AUTOMATIC" && !automaticPlatforms.has(platform);
              const connectedAccountCount = accountsByPlatform[platform].length;
              const selectableAccountCount = selectableAccountsByPlatform[platform].length;
              return (
              <label key={platform} className="selection-check platform-toggle">
                <input
                  type="checkbox"
                  checked={selectedPlatforms.includes(platform)}
                  onChange={() => togglePlatform(platform)}
                  disabled={disabled}
                />
                <span className="platform-toggle-copy">
                  <strong>{platform}</strong>
                  <small>{buildPlatformHint({ disabled, automationMode, connectedAccountCount, selectableAccountCount })}</small>
                </span>
              </label>
              );
            })}
          </div>
        </div>

        {selectedPlatforms.some((platform) => selectableAccountsByPlatform[platform].length > 0) ? (
          <div className="schedule-fieldset">
            <p className="small muted">Posting accounts</p>
            <div className="platform-toggle-grid">
              {selectedPlatforms.flatMap((platform) => selectableAccountsByPlatform[platform].map((account) => (
                <label key={`${platform}-${account.id}`} className="selection-check platform-toggle account-toggle">
                  <input
                    type="checkbox"
                    checked={Boolean(resolvedSocialAccountIdsByPlatform[platform]?.includes(account.id))}
                    onChange={() => toggleSocialAccount(platform, account.id)}
                  />
                  <span className="platform-toggle-copy">
                    <strong>{account.label}</strong>
                    <small>{platform}{account.handle ? ` · ${account.handle}` : ""}</small>
                  </span>
                </label>
              )))}
            </div>
          </div>
        ) : null}

        <div className="schedule-fieldset bulk-scheduler-sequence">
          <div className="bulk-scheduler-heading">
            <div>
              <p className="small muted">{orderedClipIds.length > 1 ? "Posting sequence" : "Post copy"}</p>
              <strong>{orderedClipIds.length > 1 ? "Arrange order and review captions" : "Review caption before scheduling"}</strong>
            </div>
            {orderedClipIds.length > 1 ? <span className="status-pill">Order controls scheduling</span> : null}
          </div>
          <div className="bulk-scheduler-list">
            {orderedClipIds.map((clipId, index) => {
              const clip = clipDetailsById.get(clipId);
              const copy = clipCopyById[clipId] ?? {
                title: clip?.title ?? `Clip ${index + 1}`,
                caption: clip?.caption ?? "",
              };
              return (
                <article key={clipId} className="bulk-scheduler-row">
                  <div className="bulk-scheduler-order">
                    <label htmlFor={`bulk-order-${clipId}`}>Order</label>
                    <input
                      id={`bulk-order-${clipId}`}
                      type="number"
                      min={1}
                      max={orderedClipIds.length}
                      value={index + 1}
                      onChange={(event) => updateClipOrder(clipId, event.target.value)}
                    />
                  </div>
                  <div className="bulk-scheduler-copy">
                    <label htmlFor={`bulk-title-${clipId}`}>Title</label>
                    <input
                      id={`bulk-title-${clipId}`}
                      value={copy.title}
                      onChange={(event) => updateClipCopy(clipId, "title", event.target.value)}
                      placeholder={clip?.title ?? "Clip title"}
                    />
                    <label htmlFor={`bulk-caption-${clipId}`}>Caption</label>
                    <textarea
                      id={`bulk-caption-${clipId}`}
                      value={copy.caption}
                      onChange={(event) => updateClipCopy(clipId, "caption", event.target.value)}
                      rows={3}
                      placeholder="Generated caption or post description"
                    />
                  </div>
                  {orderedClipIds.length > 1 ? (
                    <div className="bulk-scheduler-row-actions" aria-label={`Move ${copy.title || `clip ${index + 1}`}`}>
                      <button type="button" className="button tertiary" onClick={() => moveClip(clipId, -1)} disabled={index === 0}>
                        Up
                      </button>
                      <button type="button" className="button tertiary" onClick={() => moveClip(clipId, 1)} disabled={index === orderedClipIds.length - 1}>
                        Down
                      </button>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </div>

        <div className="schedule-fieldset schedule-two-column">
          <label htmlFor="postingSlot">
            Posting label
            <select id="postingSlot" value={postingSlot} onChange={(event) => setPostingSlot(event.target.value)}>
              {postingSlotOptions.map((slot) => (
                <option key={slot} value={slot}>{slot}</option>
              ))}
            </select>
          </label>
          {automationMode === "AUTOMATIC" ? (
            <label htmlFor="scheduledFor">
              Scheduled date and time
              <input
                id="scheduledFor"
                type="datetime-local"
                value={scheduledFor}
                onChange={(event) => setScheduledFor(event.target.value)}
              />
            </label>
          ) : null}
        </div>

        {automationMode === "AUTOMATIC" ? (
          <div className="schedule-fieldset">
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

        {automationMode === "AUTOMATIC" && orderedClipIds.length > 1 ? (
          <div className="schedule-fieldset">
            <label htmlFor="scheduleIntervalMinutes">
              Clip spacing
              <select
                id="scheduleIntervalMinutes"
                value={scheduleIntervalMinutes}
                onChange={(event) => setCustomScheduleIntervalMinutes(Number(event.target.value))}
              >
                {intervalOptions.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {minutes === suggestedIntervalMinutes ? "Suggested: " : ""}Every {formatScheduleInterval(minutes)}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted small">
              Each clip posts to all selected platforms at its assigned time. The next clip is staggered to avoid posting everything at once.
            </p>
            {schedulePreview.length > 0 ? (
              <div className="schedule-plan-preview" aria-label="Suggested posting plan">
                {schedulePreview.map((item) => (
                  <div key={item.clipId}>
                    <span>{item.label}</span>
                    <strong>{formatPlanTime(item.scheduledFor)}</strong>
                  </div>
                ))}
                {orderedClipIds.length > schedulePreview.length ? (
                  <p className="muted small">+ {orderedClipIds.length - schedulePreview.length} more clip{orderedClipIds.length - schedulePreview.length === 1 ? "" : "s"} in the same rhythm</p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <details className="schedule-optional-fields">
          <summary>Optional copy and note</summary>
          <div className="schedule-fieldset">
            <label htmlFor="postTitle">Post title</label>
            <input
              id="postTitle"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Use clip title when blank"
            />
          </div>

          <div className="schedule-fieldset">
            <label htmlFor="postCaption">Caption</label>
            <textarea
              id="postCaption"
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
              rows={3}
              placeholder="Use generated clip caption when blank"
            />
          </div>

          <div className="schedule-fieldset">
            <label htmlFor="draftNote">Media team note</label>
            <textarea
              id="draftNote"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
              placeholder="Internal note"
            />
          </div>
        </details>

        {message ? <p className={message.includes("Could not") ? "error-banner" : "success-banner"}>{message}</p> : null}
        {hasMissingAccountSelection ? <p className="error-banner">Select at least one account for each chosen platform.</p> : null}

        <div className="feature-modal-footer">
          <button type="button" className="button primary" onClick={createDraft} disabled={pending || selectedPlatforms.length === 0 || hasMissingAccountSelection}>
            {pending ? "Saving..." : automationMode === "AUTOMATIC" ? "Schedule post" : "Save posting draft"}
          </button>
        </div>
      </section>
    </div>
  );
}
