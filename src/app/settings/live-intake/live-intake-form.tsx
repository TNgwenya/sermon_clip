"use client";

import { useActionState } from "react";
import { provisionLiveIntakeAction, revealLiveIntakeAction, type LiveIntakeActionState } from "./actions";

const initialState: LiveIntakeActionState = { success: false, message: "" };

export function LiveIntakeForm({ enabled, canManage, hasIntake = false }: { enabled: boolean; canManage: boolean; hasIntake?: boolean }) {
  const [state, action, pending] = useActionState(hasIntake ? revealLiveIntakeAction : provisionLiveIntakeAction, initialState);
  if (!enabled) return <p><strong>Not enabled yet.</strong> An administrator must finish connecting the live recording provider before a church can create a live stream.</p>;
  return <form action={action} style={{ display: "grid", gap: "12px", maxWidth: 620 }}>
    {!hasIntake && !state.success ? <label>Stream name <input name="label" defaultValue="Sunday service" disabled={!canManage || pending} style={{ display: "block", width: "100%" }} /></label> : null}
    <button type="submit" disabled={!canManage || pending}>{pending ? "Connecting…" : hasIntake || state.success ? "Show encoder credentials" : "Create private stream"}</button>
    {state.message ? <p role="status">{state.message}</p> : null}
    {state.success ? <><label>RTMPS address <input readOnly value={state.ingestUrl} /></label><label>Private stream key <input type="password" readOnly autoComplete="off" value={state.streamKey} /></label><p><strong>Copy these into YoloBox or OBS.</strong> The key is not stored in Sermon Clip. A church administrator can retrieve it here again.</p></> : null}
  </form>;
}
