"use client";

import { useMemo, useState } from "react";

import type { PostingAutomationMode, PostingDraft, PostingPlatform } from "@/lib/postingDrafts";
import { formatScheduleInterval, suggestScheduleIntervalMinutes } from "@/lib/postingSchedule";
import type { SocialAccount } from "@/lib/socialAccounts";

const platforms: PostingPlatform[] = ["TikTok", "Instagram", "YouTube Shorts", "Facebook"];
const postingSlots = ["Sunday recap", "Midweek encouragement", "Prayer invitation", "Weekend invite"];
type AccountSelectionsByPlatform = Partial<Record<PostingPlatform, string[]>>;

function formatDateTimeLocal(date: Date): string {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return offsetDate.toISOString().slice(0, 16);
}

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
  socialAccounts?: SocialAccount[];
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

export function ScheduleDraftModal({ clipIds, socialAccounts = [], open, onClose, onCreated }: ScheduleDraftModalProps) {
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
  const [selectedSocialAccountIdsByPlatform, setSelectedSocialAccountIdsByPlatform] = useState<AccountSelectionsByPlatform>(() => (
    buildDefaultAccountSelections(socialAccounts)
  ));
  const [automationMode, setAutomationMode] = useState<PostingAutomationMode>("AUTOMATIC");
  const selectableAccountsByPlatform = useMemo(() => platforms.reduce((accumulator, platform) => ({
    ...accumulator,
    [platform]: accountsByPlatform[platform].filter((account) => (
      automationMode === "MANUAL" || isAutomaticPublishingAccount(account)
    )),
  }), {} as Record<PostingPlatform, SocialAccount[]>), [accountsByPlatform, automationMode]);
  const [scheduledFor, setScheduledFor] = useState(() => {
    const date = new Date(Date.now() + 60 * 60_000);
    date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0);
    return formatDateTimeLocal(date);
  });
  const [customScheduleIntervalMinutes, setCustomScheduleIntervalMinutes] = useState<number | null>(null);
  const [timezone, setTimezone] = useState("Africa/Johannesburg");
  const [postingSlot, setPostingSlot] = useState(postingSlots[0]);
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

    const interval = clipIds.length > 1 ? scheduleIntervalMinutes : 0;
    return clipIds.slice(0, 6).map((clipId, index) => ({
      clipId,
      label: `Clip ${index + 1}`,
      scheduledFor: new Date(start.getTime() + index * interval * 60_000),
    }));
  }, [automationMode, clipIds, scheduleIntervalMinutes, scheduledFor]);

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
          scheduleIntervalMinutes: clipIds.length > 1 ? scheduleIntervalMinutes : 0,
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
          <span className="status-pill status-exported">{clipIds.length} clip{clipIds.length === 1 ? "" : "s"}</span>
          <span className="status-pill">{automationMode === "AUTOMATIC" ? "Automatic posting" : "Media team handoff"}</span>
          {automationMode === "AUTOMATIC" && clipIds.length > 1 ? (
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

        <div className="schedule-fieldset schedule-two-column">
          <label htmlFor="postingSlot">
            Posting label
            <select id="postingSlot" value={postingSlot} onChange={(event) => setPostingSlot(event.target.value)}>
              {postingSlots.map((slot) => (
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

        {automationMode === "AUTOMATIC" && clipIds.length > 1 ? (
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
                {clipIds.length > schedulePreview.length ? (
                  <p className="muted small">+ {clipIds.length - schedulePreview.length} more clip{clipIds.length - schedulePreview.length === 1 ? "" : "s"} in the same rhythm</p>
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
