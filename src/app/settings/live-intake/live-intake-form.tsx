"use client";

import { useActionState } from "react";
import { provisionLiveIntakeAction, type LiveIntakeActionState } from "./actions";

const initialState: LiveIntakeActionState = { success: false, message: "" };

export function LiveIntakeForm({ enabled, canManage }: { enabled: boolean; canManage: boolean }) {
  const [state, action, pending] = useActionState(provisionLiveIntakeAction, initialState);
  if (!enabled) return <p><strong>Not enabled yet.</strong> An administrator must add the scoped Cloudflare Stream credentials and webhook secret before any church can create a live stream.</p>;
  return <form action={action} style={{ display: "grid", gap: "12px", maxWidth: 620 }}>
    <label>Stream name <input name="label" defaultValue="Sunday service" disabled={!canManage || pending} style={{ display: "block", width: "100%" }} /></label>
    <button type="submit" disabled={!canManage || pending}>{pending ? "Creating secure stream…" : "Create private stream"}</button>
    {state.message ? <p role="status">{state.message}</p> : null}
    {state.success ? <><label>RTMPS address <input readOnly value={state.ingestUrl} /></label><label>Private stream key <input readOnly value={state.streamKey} /></label><p><strong>Copy these into YoloBox or OBS now.</strong> Sermon Clip never stores or shows the key again. Rotate it if it is exposed.</p></> : null}
  </form>;
}
