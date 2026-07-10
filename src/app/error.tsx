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
          <p className="kicker">The studio paused</p>
          <h1>{uploadFailed ? "Your video could not be uploaded." : "We couldn’t open this part of Sermon Clip."}</h1>
          <p className="muted">
            {uploadFailed
              ? `The upload ended before Sermon Clip received a normal response. The recording may be larger than ${MAX_UPLOADED_MEDIA_LABEL}, the phone may have interrupted the transfer, or the hosted app may not support direct video uploads. Your file is still safe on your phone. Return to the studio and use a public or unlisted YouTube link.`
              : "Your sermon and clip work is still safe. Try this screen again, or return to the studio home and continue from there."}
          </p>
        </div>
        <div className="route-state-actions">
          {!uploadFailed ? <button className="button primary" type="button" onClick={reset}>Try again</button> : null}
          <Link className="button tertiary" href="/">Return to studio home</Link>
        </div>
        {error.digest ? <p className="muted small">Reference: {error.digest}</p> : null}
      </section>
    </main>
  );
}
