"use client";

import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";

import {
  MAX_UPLOADED_MEDIA_LABEL,
  SERMON_UPLOAD_ATTEMPT_STORAGE_KEY,
} from "@/lib/sermonIntake";

function subscribeToUploadAttempt(): () => void {
  return () => undefined;
}

function getUploadAttemptSnapshot(): boolean {
  return window.sessionStorage.getItem(SERMON_UPLOAD_ATTEMPT_STORAGE_KEY) === "true";
}

function getServerUploadAttemptSnapshot(): boolean {
  return false;
}

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const uploadFailed = useSyncExternalStore(
    subscribeToUploadAttempt,
    getUploadAttemptSnapshot,
    getServerUploadAttemptSnapshot,
  );

  useEffect(() => {
    console.error(error);
    return () => window.sessionStorage.removeItem(SERMON_UPLOAD_ATTEMPT_STORAGE_KEY);
  }, [error]);

  return (
    <main className="route-state-shell">
      <section className="route-state-card" role="alert">
        <span className="route-state-mark" aria-hidden="true">!</span>
        <div className="route-state-copy">
          <p className="kicker">{uploadFailed ? "Upload interrupted" : "This page needs another try"}</p>
          <h1>{uploadFailed ? "Your video could not be uploaded." : "We couldn’t open this part of Sermon Clip."}</h1>
          <p className="muted">
            {uploadFailed
              ? `Sermon Clip did not receive the whole recording. Your original file is still safe on your device. Keep this file, check that it is under ${MAX_UPLOADED_MEDIA_LABEL}, then retry on stable Wi-Fi or use a public or unlisted YouTube link.`
              : "No sermon, clip, or approval was changed by this screen error. Try this page once more. If it still does not open, return to your sermon library and continue from the saved sermon."}
          </p>
        </div>
        <div className="route-state-actions">
          {uploadFailed ? (
            <Link className="button primary" href="/sermons/new">Try another source</Link>
          ) : (
            <button className="button primary" type="button" onClick={reset}>Try this page again</button>
          )}
          <Link className="button tertiary" href="/sermons">Open sermon library</Link>
        </div>
        {error.digest ? <p className="muted small">Support reference: {error.digest}</p> : null}
      </section>
    </main>
  );
}
