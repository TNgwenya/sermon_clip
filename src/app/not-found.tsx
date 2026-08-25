import Link from "next/link";

export default function NotFound() {
  return (
    <main className="route-state-shell">
      <section className="route-state-card">
        <span className="route-state-mark" aria-hidden="true">404</span>
        <div className="route-state-copy">
          <p className="kicker">Page not available</p>
          <h1>We couldn’t find that page.</h1>
          <p className="muted">
            The link may be old, the page may have moved, or it may belong to another church workspace. Nothing in your workspace was changed.
          </p>
        </div>
        <div className="route-state-actions">
          <Link className="button primary" href="/">Go to Home</Link>
          <Link className="button tertiary" href="/sermons">Open sermon library</Link>
        </div>
      </section>
    </main>
  );
}
