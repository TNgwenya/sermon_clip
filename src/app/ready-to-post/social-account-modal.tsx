"use client";

import { useState } from "react";
import { createPortal } from "react-dom";

import type { PostingPlatform } from "@/lib/postingDrafts";
import type { SocialAccount } from "@/lib/socialAccounts";

type SocialAccountModalProps = {
  open: boolean;
  onClose: () => void;
  onCreated: (account: SocialAccount) => void;
  onSynced?: (accounts: SocialAccount[]) => void;
};

const SOCIAL_ACCOUNT_PLATFORMS: PostingPlatform[] = ["TikTok", "Instagram", "YouTube Shorts", "Facebook"];

export function SocialAccountModal({ open, onClose, onCreated, onSynced }: SocialAccountModalProps) {
  const [platform, setPlatform] = useState<PostingPlatform>("Instagram");
  const [label, setLabel] = useState("Church Instagram");
  const [handle, setHandle] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [syncPending, setSyncPending] = useState(false);

  if (!open || typeof document === "undefined") {
    return null;
  }

  async function saveAccount() {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/social-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform,
          label,
          handle,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        setMessage(result.error ?? "Could not save this account.");
        return;
      }
      onCreated(result.account);
      setMessage("Social account saved for posting drafts.");
    } catch {
      setMessage("Could not save this account.");
    } finally {
      setPending(false);
    }
  }

  async function syncZernioAccounts() {
    setSyncPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/social-accounts/zernio-sync", {
        method: "POST",
      });
      const result = await response.json();
      if (!response.ok) {
        setMessage(result.error ?? "Could not sync Zernio accounts.");
        return;
      }
      if (Array.isArray(result.accounts)) {
        onSynced?.(result.accounts);
      }
      setMessage(`Synced ${result.accounts?.length ?? 0} Zernio account${result.accounts?.length === 1 ? "" : "s"}.`);
    } catch {
      setMessage("Could not sync Zernio accounts.");
    } finally {
      setSyncPending(false);
    }
  }

  return createPortal(
    <div className="feature-modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="feature-modal social-account-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="social-account-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className="feature-modal-close" onClick={onClose} aria-label="Close">
          Close
        </button>
        <div className="stack-sm">
          <p className="kicker">Social accounts</p>
          <h2 id="social-account-title">Add a church channel</h2>
          <p className="muted">
            Save the channels your media team posts to. Direct publishing can connect later; for now these accounts guide drafts and captions.
          </p>
        </div>

        <div className="schedule-fieldset">
          <label htmlFor="socialPlatform">Platform</label>
          <select id="socialPlatform" value={platform} onChange={(event) => setPlatform(event.target.value as PostingPlatform)}>
            {SOCIAL_ACCOUNT_PLATFORMS.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </div>

        <div className="schedule-fieldset">
          <label htmlFor="socialLabel">Channel or page name</label>
          <input
            id="socialLabel"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Example: Renewed Life Church Page"
          />
        </div>

        <div className="schedule-fieldset">
          <label htmlFor="socialHandle">Handle or page note</label>
          <input
            id="socialHandle"
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
            placeholder="Example: @renewedlife"
          />
        </div>

        {message ? <p className={message.includes("saved") || message.includes("Synced") ? "success-banner" : "error-banner"}>{message}</p> : null}

        <div className="feature-modal-footer">
          <button type="button" className="button secondary" onClick={syncZernioAccounts} disabled={syncPending}>
            {syncPending ? "Syncing..." : "Sync Zernio accounts"}
          </button>
          <button type="button" className="button tertiary" onClick={onClose}>
            Close
          </button>
          <button type="button" className="button primary" onClick={saveAccount} disabled={pending || label.trim().length === 0}>
            {pending ? "Saving account..." : "Save account"}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
