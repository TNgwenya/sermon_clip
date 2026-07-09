"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="route-state-shell">
      <section className="route-state-card" role="alert">
        <span className="route-state-mark" aria-hidden="true">!</span>
        <div className="route-state-copy">
          <p className="kicker">The studio paused</p>
          <h1>We couldn’t open this part of Sermon Clip.</h1>
          <p className="muted">
            Your sermon and clip work is still safe. Try this screen again, or return to the studio home and continue from there.
          </p>
        </div>
        <div className="route-state-actions">
          <button className="button primary" type="button" onClick={reset}>Try again</button>
          <Link className="button tertiary" href="/">Return to studio home</Link>
        </div>
        {error.digest ? <p className="muted small">Reference: {error.digest}</p> : null}
      </section>
    </main>
  );
}
