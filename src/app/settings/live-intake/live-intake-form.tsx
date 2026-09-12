"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { provisionLiveIntakeAction, revealLiveIntakeAction, type LiveIntakeActionState } from "./actions";
import styles from "./live-intake.module.css";

const initialState: LiveIntakeActionState = { success: false, message: "" };

function CredentialField({ label, value, secret = false }: { label: string; value: string; secret?: boolean }) {
  const [visible, setVisible] = useState(false);
  const [feedback, setFeedback] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function copyValue() {
    try {
      await navigator.clipboard.writeText(value);
      setFeedback(`${label} copied.`);
    } catch {
      inputRef.current?.focus();
      inputRef.current?.select();
      setFeedback(`Could not copy automatically. Select and copy the ${label.toLowerCase()} manually${secret ? ", or show it first" : ""}.`);
    }
  }

  return (
    <div className={styles.credential}>
      <label>
        <span>{label}</span>
        <input ref={inputRef} readOnly type={secret && !visible ? "password" : "text"} value={value} autoComplete="off" spellCheck={false} />
      </label>
      <div className={styles.fieldActions}>
        <button type="button" className="button secondary" onClick={copyValue}>Copy {secret ? "stream key" : "address"}</button>
        {secret ? <button type="button" className="button tertiary" aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? "Hide stream key" : "Show stream key"}</button> : null}
      </div>
      <p className={styles.feedback} role="status" aria-live="polite">{feedback}</p>
    </div>
  );
}

export function LiveIntakeForm({ enabled, canManage, hasIntake = false }: { enabled: boolean; canManage: boolean; hasIntake?: boolean }) {
  const [state, action, pending] = useActionState(async (previous: LiveIntakeActionState, formData: FormData) => {
    return hasIntake || previous.success ? revealLiveIntakeAction() : provisionLiveIntakeAction(previous, formData);
  }, initialState);
  if (!enabled) return <div className={styles.notice}><strong>Live intake is not enabled yet.</strong><p>The service administrator needs to finish connecting live recording. You can still <Link href="/sermons/new">add a sermon recording</Link> while setup is completed.</p></div>;
  if (!canManage) return <div className={styles.notice}><strong>A church administrator handles this step.</strong><p>Ask your church administrator to create the destination or retrieve its private stream key. You can follow the setup guide and check recent recordings here.</p></div>;
  return <form action={action} className={styles.form}>
    {!hasIntake && !state.success ? <label className={styles.nameField}>Stream name <input name="label" defaultValue="Sunday service" maxLength={120} disabled={pending} /></label> : null}
    <button className="button primary" type="submit" disabled={pending}>{pending ? "Connecting…" : hasIntake || state.success ? "Show encoder credentials" : "Create private stream"}</button>
    {state.message ? <p className={styles.notice} role={state.success ? "status" : "alert"}>{state.message}</p> : null}
    {state.success && state.ingestUrl && state.streamKey ? <div className={styles.credentials}>
      <CredentialField label="RTMPS address" value={state.ingestUrl} />
      <CredentialField label="Private stream key" value={state.streamKey} secret />
      <p className={styles.helper}>Use these as the server address and stream key for a custom destination in your encoder. Keep the key private; anyone with it can send a feed to your church. A church administrator can retrieve it here again.</p>
    </div> : null}
  </form>;
}
