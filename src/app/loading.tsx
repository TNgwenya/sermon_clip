export default function AppLoading() {
  return (
    <main className="route-state-shell" aria-busy="true" aria-live="polite">
      <section className="route-state-card" role="status">
        <span className="route-state-mark" aria-hidden="true">SC</span>
        <div className="route-state-copy">
          <p className="kicker">Preparing your studio</p>
          <h1>Bringing your sermon workspace into focus.</h1>
          <p className="muted">Loading the latest clips, edits, and publishing progress.</p>
        </div>
        <div className="stack-sm" aria-hidden="true">
          <span className="route-loading-line" />
          <span className="route-loading-line short" />
        </div>
        <div className="route-loading-grid" aria-hidden="true">
          <span className="route-loading-panel" />
          <span className="route-loading-panel" />
        </div>
        <span className="sr-only">Sermon Clip is loading.</span>
      </section>
    </main>
  );
}
