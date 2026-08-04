"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function EventLiveRefresh({
  enabled,
  activeCount,
  intervalMs = 10_000,
}: {
  enabled: boolean;
  activeCount: number;
  intervalMs?: number;
}) {
  const router = useRouter();
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;
    const timer = window.setInterval(() => {
      setLastChecked(new Date());
      router.refresh();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [enabled, intervalMs, router]);

  return (
    <div className={`live-refresh-panel ${enabled ? "is-live" : "is-paused"}`} aria-live="polite">
      <div>
        <p className="muted small">{enabled ? "Event dashboard updating automatically" : "Event dashboard is up to date"}</p>
        <strong>{activeCount > 0 ? `${activeCount} session${activeCount === 1 ? "" : "s"} in progress` : "No active processing"}</strong>
        <p className="muted small">
          {lastChecked ? `Last checked ${lastChecked.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Status checked just now"}
        </p>
      </div>
      <button type="button" className="button tertiary" onClick={() => {
        setLastChecked(new Date());
        router.refresh();
      }}>
        Refresh now
      </button>
    </div>
  );
}
