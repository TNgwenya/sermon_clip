"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type SessionState = "active" | "expired" | "different" | "offline";

export async function checkStudioSession(actorId: string, organizationId: string): Promise<SessionState> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch("/api/studio/session", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    });
    if (response.status === 401) return "expired";
    if (!response.ok) return "offline";
    const session = await response.json();
    return session.actorId === actorId && session.organizationId === organizationId ? "active" : "different";
  } catch {
    return "offline";
  } finally {
    clearTimeout(timeout);
  }
}

export function ClipStudioSessionGuard({ actorId, organizationId }: {
  actorId: string;
  organizationId: string;
}) {
  const [state, setState] = useState<SessionState>("active");
  const pending = useRef(false);
  const check = useCallback(async () => {
    if (pending.current) return;
    pending.current = true;
    try {
      setState(await checkStudioSession(actorId, organizationId));
    } finally {
      pending.current = false;
    }
  }, [actorId, organizationId]);

  useEffect(() => {
    void check();
    const onFocus = () => { void check(); };
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void check();
    }, 60_000);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [check]);

  if (state === "active") return null;

  return (
    <aside role="alert" className="card" style={{ gridColumn: "1 / -1", padding: "0.75rem 1rem" }}>
      <strong>{state === "expired" ? "Sign in again to save your draft" : state === "different" ? "Your signed-in workspace has changed" : "Connection interrupted"}</strong>
      <p>{state === "offline"
        ? "Your edits are still in this tab. Keep it open and reconnect before saving."
        : "Your edits are still in this tab. Keep it open, sign in with the same account and church in a separate tab, then return here."}</p>
      {state !== "offline" && <a className="button" href="/login" target="_blank" rel="noopener noreferrer">Sign in in a new tab</a>}
      {" "}<button type="button" className="button" onClick={() => void check()}>Check connection</button>
    </aside>
  );
}
