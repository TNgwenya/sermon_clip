"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";

import type { PostingAutomationMode, PostingDraft, PostingPlatform } from "@/lib/postingDrafts";
import {
  formatScheduleInterval,
  resolveScheduledInstant,
  suggestScheduleIntervalMinutes,
  toDateTimeLocalInputValue,
} from "@/lib/postingSchedule";
import type { CanonicalPlatformPayload } from "@/lib/publishingPayload";
import type { PublishingPreflightPacket } from "@/lib/publishingPreflight";
import type { SocialAccount } from "@/lib/socialAccounts";

const platforms: PostingPlatform[] = ["TikTok", "Instagram", "YouTube Shorts", "Facebook"];
const postingSlots = ["Sunday recap", "Midweek encouragement", "Prayer invitation", "Weekend invite"];
type AccountSelectionsByPlatform = Partial<Record<PostingPlatform, string[]>>;
export type ScheduleDraftClipSummary = {
  id: string;
  title: string;
  caption: string;
  platformPayloads?: CanonicalPlatformPayload[];
};

type EditablePlatformCopy = Record<PostingPlatform, { title: string; caption: string }>;

function buildEditablePlatformCopy(clip: ScheduleDraftClipSummary): EditablePlatformCopy {
  const payloads = new Map((clip.platformPayloads ?? []).map((payload) => [payload.platform, payload]));
  return Object.fromEntries(platforms.map((platform) => {
    const payload = payloads.get(platform);
    return [platform, {
      title: payload?.title ?? clip.title,
      caption: payload?.caption ?? clip.caption,
    }];
  })) as EditablePlatformCopy;
}

function platformId(platform: PostingPlatform): string {
  return platform.toLowerCase().replace(/\s+/g, "-");
}

function platformCopyLimits(platform: PostingPlatform): { title: number; caption: number } {
  if (platform === "Facebook") {
    return { title: 255, caption: 63_206 };
  }

  if (platform === "YouTube Shorts") {
    return { title: 100, caption: 5000 };
  }

  return { title: 2200, caption: 2200 };
}

function formatPlanTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function createScheduleRequestKey(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `schedule-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type ScheduleDraftModalProps = {
  clipIds: string[];
  clipDetails?: ScheduleDraftClipSummary[];
  socialAccounts?: SocialAccount[];
  initialAutomationMode?: PostingAutomationMode;
  initialPlatform?: PostingPlatform | null;
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
    && account.externalPlatform?.toLowerCase() === platform.toLowerCase()
  ));
}

function buildAutomaticPlatforms(accounts: SocialAccount[]): Set<PostingPlatform> {
  return new Set<PostingPlatform>([
    ...(accounts.some((account) => account.platform === "TikTok" && isAutomaticPublishingAccount(account))
      ? ["TikTok" as const]
      : []),
    ...(hasSyncedZernioAccount(accounts, "Instagram") ? ["Instagram" as const] : []),
    "YouTube Shorts",
    "Facebook",
  ]);
}

function buildDefaultAccountSelections(accounts: SocialAccount[]): AccountSelectionsByPlatform {
  return platforms.reduce((accumulator, platform) => {
    const platformAccounts = accounts.filter((account) => account.platform === platform);
    return platformAccounts.length === 1
      ? { ...accumulator, [platform]: [platformAccounts[0].id] }
      : accumulator;
  }, {} as AccountSelectionsByPlatform);
}

function isAutomaticPublishingAccount(account: SocialAccount): boolean {
  if (account.platform === "TikTok") {
    return account.credentialReady || (
      account.externalProvider === "zernio"
      && Boolean(account.externalAccountId)
      && account.externalPlatform?.toLowerCase() === "tiktok"
    );
  }

  if (account.platform !== "Instagram") {
    return true;
  }

  return account.externalProvider === "zernio"
    && Boolean(account.externalAccountId)
    && account.externalPlatform?.toLowerCase() === account.platform.toLowerCase();
}

function isVerifiedAutomaticPublishingAccount(account: SocialAccount): boolean {
  if (account.status !== "CONNECTED") return false;
  if (account.platform === "TikTok" || account.platform === "Instagram") {
    return isAutomaticPublishingAccount(account);
  }
  return account.credentialReady || Boolean(account.externalProvider && account.externalAccountId);
}

function buildPlatformHint(input: {
  disabled: boolean;
  automationMode: PostingAutomationMode;
  selectableAccountCount: number;
}): string {
  if (input.disabled) {
    return "Verified publishing account required";
  }

  if (input.selectableAccountCount > 0) {
    return input.automationMode === "AUTOMATIC"
      ? `${input.selectableAccountCount} saved channel${input.selectableAccountCount === 1 ? "" : "s"}`
      : `${input.selectableAccountCount} handoff channel${input.selectableAccountCount === 1 ? "" : "s"}`;
  }

  return input.automationMode === "AUTOMATIC" ? "Verify publishing setup" : "No saved channel required";
}

export function ScheduleDraftModal({
  clipIds,
  clipDetails = [],
  socialAccounts = [],
  initialAutomationMode,
  initialPlatform,
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
    platformPayloads: clipDetailsById.get(clipId)?.platformPayloads,
  })), [clipDetailsById, clipIds]);
  const automaticPlatforms = buildAutomaticPlatforms(socialAccounts);
  const hasVerifiedAutomaticCapability = socialAccounts.some(isVerifiedAutomaticPublishingAccount);
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
  const shouldDefaultAutomatic = hasVerifiedAutomaticCapability && initialAutomationMode !== "MANUAL";
  const defaultPlatform = shouldDefaultAutomatic
    ? initialPlatform && automaticPlatforms.has(initialPlatform) ? initialPlatform : defaultAutomaticPlatform
    : initialPlatform
      ?? socialAccounts.find((account) => account.status === "CONNECTED")?.platform
      ?? defaultAutomaticPlatform;
  const [selectedPlatforms, setSelectedPlatforms] = useState<PostingPlatform[]>([defaultPlatform]);
  const [orderedClipIds, setOrderedClipIds] = useState(() => clipIds);
  const [platformCopyByClipId, setPlatformCopyByClipId] = useState<Record<string, EditablePlatformCopy>>(() => (
    Object.fromEntries(fallbackClipDetails.map((clip) => [clip.id, buildEditablePlatformCopy(clip)]))
  ));
  const [selectedSocialAccountIdsByPlatform, setSelectedSocialAccountIdsByPlatform] = useState<AccountSelectionsByPlatform>(() => (
    buildDefaultAccountSelections(socialAccounts)
  ));
  const [automationMode, setAutomationMode] = useState<PostingAutomationMode>(() => (
    shouldDefaultAutomatic ? "AUTOMATIC" : "MANUAL"
  ));
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
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [preflight, setPreflight] = useState<PublishingPreflightPacket | null>(null);
  const [pending, setPending] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(createScheduleRequestKey);
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

    return platformAccounts.length === 1
      ? { ...accumulator, [platform]: [platformAccounts[0].id] }
      : { ...accumulator, [platform]: [] };
  }, {} as AccountSelectionsByPlatform), [selectableAccountsByPlatform, selectedSocialAccountIdsByPlatform]);
  const scheduleIntervalMinutes = customScheduleIntervalMinutes ?? suggestedIntervalMinutes;
  const hasMissingAccountSelection = selectedPlatforms.some((platform) => (
    selectableAccountsByPlatform[platform].length > 0
    && (resolvedSocialAccountIdsByPlatform[platform]?.length ?? 0) === 0
  ));
  const hasMissingPlatformCopy = orderedClipIds.some((clipId) => selectedPlatforms.some((platform) => {
    const copy = platformCopyByClipId[clipId]?.[platform];
    return !copy?.title.trim() || !copy.caption.trim();
  }));
  const schedulePreview = useMemo(() => {
    const start = resolveScheduledInstant(scheduledFor, timezone);
    if (automationMode !== "AUTOMATIC" || !start) {
      return [];
    }

    const interval = orderedClipIds.length > 1 ? scheduleIntervalMinutes : 0;
    return orderedClipIds.slice(0, 8).map((clipId, index) => ({
      clipId,
      label: platformCopyByClipId[clipId]?.[selectedPlatforms[0] ?? "TikTok"]?.title
        || clipDetailsById.get(clipId)?.title
        || `Clip ${index + 1}`,
      scheduledFor: new Date(start.getTime() + index * interval * 60_000),
    }));
  }, [automationMode, clipDetailsById, orderedClipIds, platformCopyByClipId, scheduleIntervalMinutes, scheduledFor, selectedPlatforms, timezone]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  function togglePlatform(platform: PostingPlatform) {
    if (automationMode === "AUTOMATIC" && !automaticPlatforms.has(platform)) {
      return;
    }

    setPreflight(null);
    setSelectedPlatforms((current) => (
      current.includes(platform)
        ? current.filter((item) => item !== platform)
        : [...current, platform]
    ));
  }

  function toggleSocialAccount(platform: PostingPlatform, accountId: string) {
    setPreflight(null);
    setSelectedSocialAccountIdsByPlatform((current) => {
      const currentIds = resolvedSocialAccountIdsByPlatform[platform] ?? [];
      const nextIds = automationMode === "AUTOMATIC"
        ? currentIds.includes(accountId) ? [] : [accountId]
        : currentIds.includes(accountId)
          ? currentIds.filter((item) => item !== accountId)
          : [...currentIds, accountId];

      return {
        ...current,
        [platform]: nextIds,
      };
    });
  }

  function changeAutomationMode(mode: PostingAutomationMode) {
    setPreflight(null);
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

  function updateClipCopy(clipId: string, platform: PostingPlatform, field: "title" | "caption", value: string) {
    setPlatformCopyByClipId((current) => ({
      ...current,
      [clipId]: {
        ...(current[clipId] ?? buildEditablePlatformCopy(clipDetailsById.get(clipId) ?? {
          id: clipId,
          title: "Sermon clip",
          caption: "",
        })),
        [platform]: {
          title: current[clipId]?.[platform]?.title ?? clipDetailsById.get(clipId)?.title ?? "",
          caption: current[clipId]?.[platform]?.caption ?? clipDetailsById.get(clipId)?.caption ?? "",
          [field]: value,
        },
      },
    }));
  }

  async function createDraft() {
    setPending(true);
    setMessage("");
    try {
      const socialAccountIdsByPlatform = selectedPlatforms.reduce((accumulator, platform) => {
        const accountIds = resolvedSocialAccountIdsByPlatform[platform]?.filter(Boolean) ?? [];
        return accountIds.length > 0 ? { ...accumulator, [platform]: accountIds } : accumulator;
      }, {} as AccountSelectionsByPlatform);
      const platformCopy = orderedClipIds.reduce((accumulator, clipId) => ({
        ...accumulator,
        [clipId]: selectedPlatforms.reduce((copies, platform) => ({
          ...copies,
          [platform]: platformCopyByClipId[clipId]?.[platform] ?? {
            title: clipDetailsById.get(clipId)?.title ?? "Sermon clip",
            caption: clipDetailsById.get(clipId)?.caption ?? "",
          },
        }), {} as Partial<EditablePlatformCopy>),
      }), {} as Record<string, Partial<EditablePlatformCopy>>);
      const requestBody = {
        clipIds: orderedClipIds,
        platforms: selectedPlatforms,
        socialAccountIdsByPlatform,
        automationMode,
        scheduledFor: automationMode === "AUTOMATIC" ? scheduledFor : null,
        timezone,
        postingSlot,
        note,
        scheduleIntervalMinutes: orderedClipIds.length > 1 ? scheduleIntervalMinutes : 0,
        platformCopyByClipId: platformCopy,
        idempotencyKey,
      };
      const preflightResponse = await fetch("/api/ready-to-post/preflight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const preflightResult = await preflightResponse.json();
      if (!preflightResponse.ok || !preflightResult.preflight) {
        setMessage(preflightResult.error ?? "Could not check publishing readiness.");
        return;
      }
      setPreflight(preflightResult.preflight);
      if (!preflightResult.preflight.canSchedule) {
        setMessage("Publishing checks found an item to resolve before scheduling.");
        return;
      }

      const response = await fetch("/api/ready-to-post/drafts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(requestBody),
      });
      const result = await response.json();
      if (!response.ok) {
        setMessage(result.error ?? "Could not create the posting draft.");
        return;
      }
      onCreated(result.draft);
      setIdempotencyKey(createScheduleRequestKey());
      setMessage(automationMode === "AUTOMATIC" ? "Automatic posting plan scheduled." : "Posting draft saved for the media team.");
    } catch {
      setMessage("Could not create the posting draft.");
    } finally {
      setPending(false);
    }
  }

  return createPortal(
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
          <p className="muted">Choose whether Sermon Clip should queue a verified publishing connection or prepare a clear handoff for your media team.</p>
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
              <span className="platform-toggle-copy">
                <strong>Publish automatically</strong>
                <small>Requires a configured publishing connection and queues the post for the chosen time.</small>
              </span>
            </label>
            <label className="selection-check platform-toggle">
              <input
                type="radio"
                name="automationMode"
                checked={automationMode === "MANUAL"}
                onChange={() => changeAutomationMode("MANUAL")}
              />
              <span className="platform-toggle-copy">
                <strong>Prepare for manual upload</strong>
                <small>Your team downloads the video, copies the approved text, and posts it themselves.</small>
              </span>
            </label>
          </div>
          {automationMode === "AUTOMATIC" && !hasVerifiedAutomaticCapability ? (
            <div className="schedule-mode-guidance needs-attention">
              <strong>Confirm publishing setup first</strong>
              <p className="muted small">No verified automatic publishing account is visible here. This workspace may use server-managed publishing, but Sermon Clip cannot confirm that from this screen.</p>
              <Link href="/settings/social" className="text-link small">Review social channels</Link>
            </div>
          ) : automationMode === "AUTOMATIC" ? (
            <div className="schedule-mode-guidance is-ready">
              <strong>Verified publishing account found</strong>
              <p className="muted small">Choose one of the available channels below and review the exact time before scheduling.</p>
            </div>
          ) : (
            <div className="schedule-mode-guidance">
              <strong>Your team stays in control</strong>
              <p className="muted small">Saving this plan will not publish anything automatically.</p>
            </div>
          )}
        </div>

        <div className="schedule-fieldset">
          <p className="small muted">Platforms</p>
          <div className="platform-toggle-grid">
            {platforms.map((platform) => {
              const disabled = automationMode === "AUTOMATIC" && !automaticPlatforms.has(platform);
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
                  <small>{buildPlatformHint({ disabled, automationMode, selectableAccountCount })}</small>
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
              const copies = platformCopyByClipId[clipId]
                ?? buildEditablePlatformCopy(clip ?? {
                  id: clipId,
                  title: `Clip ${index + 1}`,
                  caption: "",
                });
              const rowTitle = copies[selectedPlatforms[0] ?? "TikTok"].title || clip?.title || `Clip ${index + 1}`;
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
                    {selectedPlatforms.map((platform) => {
                      const copy = copies[platform];
                      const idSuffix = `${clipId}-${platformId(platform)}`;
                      const limits = platformCopyLimits(platform);
                      return (
                        <fieldset key={platform} className="schedule-fieldset">
                          <legend>{platform} copy</legend>
                          <label htmlFor={`bulk-title-${idSuffix}`}>Title</label>
                          <input
                            id={`bulk-title-${idSuffix}`}
                            value={copy.title}
                            onChange={(event) => updateClipCopy(clipId, platform, "title", event.target.value)}
                            placeholder={clip?.title ?? "Clip title"}
                            maxLength={limits.title}
                          />
                          <label htmlFor={`bulk-caption-${idSuffix}`}>Caption</label>
                          <textarea
                            id={`bulk-caption-${idSuffix}`}
                            value={copy.caption}
                            onChange={(event) => updateClipCopy(clipId, platform, "caption", event.target.value)}
                            rows={3}
                            placeholder="Generated platform caption"
                            maxLength={limits.caption}
                          />
                        </fieldset>
                      );
                    })}
                  </div>
                  {orderedClipIds.length > 1 ? (
                    <div className="bulk-scheduler-row-actions" aria-label={`Move ${rowTitle}`}>
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
                    <strong>{formatPlanTime(item.scheduledFor, timezone)}</strong>
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
          <summary>Optional media team note</summary>
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

        {preflight ? (
          <div className={`schedule-mode-guidance ${preflight.canSchedule ? "is-ready" : "needs-attention"}`}>
            <strong>
              {preflight.canSchedule
                ? `Publishing checks passed${preflight.warningCount > 0 ? ` with ${preflight.warningCount} note${preflight.warningCount === 1 ? "" : "s"}` : ""}`
                : `${preflight.blockerCount} publishing check${preflight.blockerCount === 1 ? " needs" : "s need"} attention`}
            </strong>
            <details open={!preflight.canSchedule}>
              <summary>View account, media, format, duration, framing, and privacy checks</summary>
              <ul>
                {preflight.checks.map((check) => (
                  <li key={check.id}>
                    <strong>{check.status === "PASS" ? "Ready" : check.status === "WARNING" ? "Review" : "Resolve"}: {check.label}</strong>
                    <span className="muted small"> {check.summary}</span>
                  </li>
                ))}
              </ul>
            </details>
          </div>
        ) : null}

        {message ? <p className={message.includes("Could not") || message.includes("resolve") ? "error-banner" : "success-banner"}>{message}</p> : null}
        {hasMissingAccountSelection ? <p className="error-banner">Select at least one account for each chosen platform.</p> : null}
        {hasMissingPlatformCopy ? <p className="error-banner">Add a title and caption for every selected platform before scheduling.</p> : null}

        <div className="feature-modal-footer">
          <button type="button" className="button primary" onClick={createDraft} disabled={pending || selectedPlatforms.length === 0 || hasMissingAccountSelection || hasMissingPlatformCopy}>
            {pending ? "Checking publishing setup..." : automationMode === "AUTOMATIC" ? "Check & schedule post" : "Check & save posting draft"}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
