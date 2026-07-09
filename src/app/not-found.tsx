import Link from "next/link";

export default function NotFound() {
  return (
    <main className="route-state-shell">
      <section className="route-state-card">
        <span className="route-state-mark" aria-hidden="true">404</span>
        <div className="route-state-copy">
          <p className="kicker">Nothing here</p>
          <h1>This studio page couldn’t be found.</h1>
          <p className="muted">
            The sermon, clip, or link may have moved. Open your sermon library to find the latest version.
          </p>
        </div>
        <div className="route-state-actions">
          <Link className="button primary" href="/sermons">Open sermon library</Link>
          <Link className="button tertiary" href="/">Return to studio home</Link>
        </div>
      </section>
    </main>
  );
}
