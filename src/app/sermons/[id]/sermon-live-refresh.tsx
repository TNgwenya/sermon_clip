"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type SermonLiveRefreshProps = {
  enabled: boolean;
  intervalMs?: number;
  progressPercent: number;
  activeStepLabel: string;
};

function formatCheckedAt(value: Date): string {
  return value.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function SermonLiveRefresh({
  enabled,
  intervalMs = 8000,
  progressPercent,
  activeStepLabel,
}: SermonLiveRefreshProps) {
  const router = useRouter();
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);
  const checkedAtLabel = lastCheckedAt ? formatCheckedAt(lastCheckedAt) : "just now";

  function refreshNow() {
    setLastCheckedAt(new Date());
    router.refresh();
  }

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setLastCheckedAt(new Date());
      router.refresh();
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [enabled, intervalMs, router]);

  return (
    <div className={`live-refresh-panel ${enabled ? "is-live" : "is-paused"}`} aria-live="polite">
      <div>
        <p className="muted small">{enabled ? "Updating automatically" : "Waiting to continue"}</p>
        <strong>{activeStepLabel}</strong>
        <p className="muted small">
          {progressPercent}% complete · Updated {checkedAtLabel}
        </p>
      </div>
      <button type="button" className="button tertiary" onClick={refreshNow}>
        Refresh now
      </button>
    </div>
  );
}
