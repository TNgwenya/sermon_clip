"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge, type UiTone } from "@/components/ui";

export type ContentGenerationStatusView = {
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
  progressPercent: number;
  title: string;
  message: string;
};

export function ContentGenerationStatus({
  view,
  refreshIntervalMs = 5_000,
}: {
  view: ContentGenerationStatusView | null;
  refreshIntervalMs?: number;
}) {
  const router = useRouter();
  const active = view?.status === "PENDING" || view?.status === "RUNNING";

  useEffect(() => {
    if (!active) return;
    const interval = window.setInterval(() => router.refresh(), refreshIntervalMs);
    return () => window.clearInterval(interval);
  }, [active, refreshIntervalMs, router]);

  if (!view) return null;
  const statusTone: UiTone =
    view.status === "SUCCEEDED"
      ? "success"
      : view.status === "FAILED"
        ? "danger"
        : view.status === "RUNNING"
          ? "info"
          : "neutral";

  return (
    <section
      className={`card stack-sm${view.status === "FAILED" ? " error-banner" : ""}`}
      aria-live="polite"
      aria-busy={active}
    >
      <div className="actions-row spread">
        <div className="stack-sm">
          <p className="kicker">Content generation</p>
          <strong>{view.title}</strong>
        </div>
        <StatusBadge tone={statusTone}>{view.status.toLowerCase()}</StatusBadge>
      </div>
      <p className="muted small">{view.message}</p>
      {active ? (
        <progress value={view.progressPercent} max={100} aria-label="Content generation progress">
          {view.progressPercent}%
        </progress>
      ) : null}
    </section>
  );
}
