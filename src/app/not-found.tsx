import Link from "next/link";

export default function NotFound() {
  return (
    <main className="route-state-shell">
      <section className="route-state-card">
        <span className="route-state-mark" aria-hidden="true">404</span>
        <div className="route-state-copy">
          <p className="kicker">Page not available</p>
          <h1>We couldn’t find this sermon page.</h1>
          <p className="muted">
            The link may be old, the item may belong to another church workspace, or it may no longer be shared. Your saved sermons are available in the sermon library.
          </p>
        </div>
        <div className="route-state-actions">
          <Link className="button primary" href="/sermons">Open sermon library</Link>
          <Link className="button tertiary" href="/sermons/new">Add a sermon</Link>
        </div>
      </section>
    </main>
  );
}
