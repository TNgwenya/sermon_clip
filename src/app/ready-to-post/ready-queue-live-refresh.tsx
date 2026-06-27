"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import type { ReadyQueueStatus } from "@/lib/readyToPost";

type ReadyQueueLiveRefreshProps = {
  status: ReadyQueueStatus;
  intervalMs?: number;
};

function formatCheckedAt(value: Date): string {
  return value.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function ReadyQueueLiveRefresh({ status, intervalMs = 8000 }: ReadyQueueLiveRefreshProps) {
  const router = useRouter();
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);
  const helperText = useMemo(() => {
    if (status.liveRefreshEnabled) {
      return `Checking again about every ${Math.round(intervalMs / 1000)} seconds.`;
    }

    if (status.approvedWaitingCount > 0) {
      return "Ready downloads appear here after approved clips are prepared.";
    }

    return "Finished sermon clips will appear here when preparation is complete.";
  }, [intervalMs, status.approvedWaitingCount, status.liveRefreshEnabled]);
  const checkedAtLabel = lastCheckedAt ? formatCheckedAt(lastCheckedAt) : "just now";

  function refreshNow() {
    setLastCheckedAt(new Date());
    setRefreshCount((current) => current + 1);
    router.refresh();
  }

  useEffect(() => {
    if (!status.liveRefreshEnabled) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setLastCheckedAt(new Date());
      setRefreshCount((current) => current + 1);
      router.refresh();
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [intervalMs, router, status.liveRefreshEnabled]);

  return (
    <section className={`queue-live-panel ${status.liveRefreshEnabled ? "is-live" : "is-paused"}`} aria-live="polite">
      <div className="stack-sm">
        <p className="kicker">{status.liveRefreshEnabled ? "Preparing clips" : "Queue status"}</p>
        <h2>{status.headline}</h2>
        <p className="muted">{status.description}</p>
        <p className="muted small">
          Last checked {checkedAtLabel}
          {refreshCount > 0 ? ` · ${refreshCount} update${refreshCount === 1 ? "" : "s"}` : ""}
          {" · "}
          {helperText}
        </p>
      </div>
      <div className="review-priority-actions">
        <button type="button" className="button tertiary" onClick={refreshNow}>
          Check now
        </button>
        {status.readyCount === 0 ? (
          <Link href="/" className="button secondary">
            Open dashboard
          </Link>
        ) : null}
      </div>
    </section>
  );
}
