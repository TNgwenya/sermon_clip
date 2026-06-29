"use client";

import { useState } from "react";

import type { PostingDraft } from "@/lib/postingDrafts";
import type { SocialAccount } from "@/lib/socialAccounts";
import { ScheduleDraftModal } from "@/app/ready-to-post/schedule-draft-modal";
import { SocialAccountModal } from "@/app/ready-to-post/social-account-modal";

type ReadyQueueActionsProps = {
  clipCount?: number;
  selectedCount?: number;
  downloadHref?: string;
  selectedClipIds?: string[];
  socialAccounts?: SocialAccount[];
  onSelectAll?: () => void;
  onClearSelection?: () => void;
  onDraftCreated?: (draft: PostingDraft) => void;
  onSocialAccountCreated?: (account: SocialAccount) => void;
  onSocialAccountsSynced?: (accounts: SocialAccount[]) => void;
  controlPanelMode?: boolean;
};

export function ReadyQueueActions({
  clipCount = 0,
  selectedCount = 0,
  downloadHref = "/api/ready-to-post/download?clipIds=all",
  selectedClipIds = [],
  socialAccounts = [],
  onSelectAll,
  onClearSelection,
  onDraftCreated,
  onSocialAccountCreated,
  onSocialAccountsSynced,
  controlPanelMode = false,
}: ReadyQueueActionsProps) {
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [socialOpen, setSocialOpen] = useState(false);
  const hasClips = clipCount > 0;
  const allSelected = hasClips && selectedCount === clipCount;
  const scheduleClipIds = selectedClipIds.length > 0 ? selectedClipIds : [];

  return (
    <>
      <div className="topbar-actions">
        <button
          type="button"
          className="button tertiary"
          onClick={allSelected ? onClearSelection : onSelectAll}
          disabled={!hasClips}
        >
          {allSelected ? "Clear selection" : "Select all"}
        </button>
        {!controlPanelMode ? (
          <a className={`button primary ${hasClips ? "" : "is-disabled"}`} href={hasClips ? downloadHref : "#"}>
            {selectedCount > 0 ? "Download selected" : "Download all"}
          </a>
        ) : null}
        <button
          type="button"
          className="button tertiary"
          onClick={() => setScheduleOpen(true)}
          disabled={selectedClipIds.length === 0}
        >
          Schedule selected
        </button>
        <button type="button" className="button tertiary" onClick={() => setSocialOpen(true)}>
          {socialAccounts.length > 0 ? "Manage social accounts" : "Add social accounts"}
        </button>
        <a href="/settings/branding" className="button secondary">Brand Kit</a>
      </div>
      <ScheduleDraftModal
        clipIds={scheduleClipIds}
        socialAccounts={socialAccounts}
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        onCreated={(draft) => {
          onDraftCreated?.(draft);
          setScheduleOpen(false);
        }}
      />
      <SocialAccountModal
        open={socialOpen}
        onClose={() => setSocialOpen(false)}
        onCreated={(account) => {
          onSocialAccountCreated?.(account);
          setSocialOpen(false);
        }}
        onSynced={onSocialAccountsSynced}
      />
    </>
  );
}

type SchedulePostButtonProps = {
  clipId: string;
  label?: string;
  socialAccounts?: SocialAccount[];
  onDraftCreated?: (draft: PostingDraft) => void;
};

export function SchedulePostButton({ clipId, label = "Schedule post", socialAccounts = [], onDraftCreated }: SchedulePostButtonProps) {
  const [scheduleOpen, setScheduleOpen] = useState(false);

  return (
    <>
      <button type="button" className="button tertiary" onClick={() => setScheduleOpen(true)}>
        {label}
      </button>
      <ScheduleDraftModal
        clipIds={[clipId]}
        socialAccounts={socialAccounts}
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        onCreated={(draft) => {
          onDraftCreated?.(draft);
          setScheduleOpen(false);
        }}
      />
    </>
  );
}
