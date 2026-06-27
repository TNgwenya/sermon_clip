"use client";

import { useEffect, useMemo, useState } from "react";
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
  const [refreshCount, setRefreshCount] = useState(0);
  const nextCheckLabel = useMemo(() => {
    if (!enabled) {
      return "Live updates are paused until work starts again.";
    }

    return `Checking again about every ${Math.round(intervalMs / 1000)} seconds.`;
  }, [enabled, intervalMs]);
  const checkedAtLabel = lastCheckedAt ? formatCheckedAt(lastCheckedAt) : "just now";

  function refreshNow() {
    setLastCheckedAt(new Date());
    setRefreshCount((current) => current + 1);
    router.refresh();
  }

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setLastCheckedAt(new Date());
      setRefreshCount((current) => current + 1);
      router.refresh();
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [enabled, intervalMs, router]);

  return (
    <div className={`live-refresh-panel ${enabled ? "is-live" : "is-paused"}`} aria-live="polite">
      <div>
        <p className="muted small">{enabled ? "Live progress is on" : "Progress is waiting"}</p>
        <strong>{activeStepLabel}</strong>
        <p className="muted small">
          {progressPercent}% complete · Last checked {checkedAtLabel}
          {refreshCount > 0 ? ` · ${refreshCount} update${refreshCount === 1 ? "" : "s"}` : ""}
        </p>
        <p className="muted small">{nextCheckLabel}</p>
      </div>
      <button type="button" className="button tertiary" onClick={refreshNow}>
        Check now
      </button>
    </div>
  );
}
