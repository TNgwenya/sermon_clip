"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  SUPPORT_BOARD_CATEGORIES,
  SUPPORT_INCIDENT_CATEGORIES,
  SUPPORT_INCIDENT_OUTCOMES,
  SUPPORT_INCIDENT_SEVERITIES,
  SUPPORT_INCIDENT_STATUSES,
} from "@/server/pilotTelemetry/supportEffort";

import {
  recordPilotSupportEffortAction,
} from "./support-effort-actions";
import type { SupportEffortActionState } from "./support-effort-action-helpers";
import styles from "./support-effort-form.module.css";

const initialState: SupportEffortActionState = { success: false, message: "" };

function friendly(value: string): string {
  return value.toLowerCase().replaceAll("_", " ").replace(/^./u, (letter) => letter.toUpperCase());
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending}>{pending ? "Recording…" : "Record support effort"}</button>;
}

export function SupportEffortForm({ today }: { today: string }) {
  const [state, action] = useActionState(recordPilotSupportEffortAction, initialState);
  return (
    <section className={styles.panel} aria-labelledby="support-effort-heading">
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>Operator record</p>
          <h2 id="support-effort-heading">Record support effort</h2>
        </div>
        <p>Categories and totals only. Do not enter names, sermon details, notes, links, or incident identifiers.</p>
      </div>
      <form action={action} className={styles.form}>
        <label>
          <span>Board incident category</span>
          <select name="boardCategory" defaultValue="OPERATIONAL" aria-invalid={Boolean(state.fieldErrors?.boardCategory)} aria-describedby={state.fieldErrors?.boardCategory ? "support-board-category-error" : undefined}>
            {SUPPORT_BOARD_CATEGORIES.map((value) => <option key={value} value={value}>{friendly(value)}</option>)}
          </select>
          {state.fieldErrors?.boardCategory && <small id="support-board-category-error">{state.fieldErrors.boardCategory}</small>}
        </label>
        <label>
          <span>Category</span>
          <select name="category" defaultValue="PROCESSING" aria-invalid={Boolean(state.fieldErrors?.category)} aria-describedby={state.fieldErrors?.category ? "support-category-error" : undefined}>
            {SUPPORT_INCIDENT_CATEGORIES.map((value) => <option key={value} value={value}>{friendly(value)}</option>)}
          </select>
          {state.fieldErrors?.category && <small id="support-category-error">{state.fieldErrors.category}</small>}
        </label>
        <label>
          <span>Severity</span>
          <select name="severity" defaultValue="LOW" aria-invalid={Boolean(state.fieldErrors?.severity)} aria-describedby={state.fieldErrors?.severity ? "support-severity-error" : undefined}>
            {SUPPORT_INCIDENT_SEVERITIES.map((value) => <option key={value} value={value}>{friendly(value)}</option>)}
          </select>
          {state.fieldErrors?.severity && <small id="support-severity-error">{state.fieldErrors.severity}</small>}
        </label>
        <label>
          <span>Status</span>
          <select name="status" defaultValue="RESOLVED" aria-invalid={Boolean(state.fieldErrors?.status)} aria-describedby={state.fieldErrors?.status ? "support-status-error" : undefined}>
            {SUPPORT_INCIDENT_STATUSES.map((value) => <option key={value} value={value}>{friendly(value)}</option>)}
          </select>
          {state.fieldErrors?.status && <small id="support-status-error">{state.fieldErrors.status}</small>}
        </label>
        <label>
          <span>Outcome</span>
          <select name="outcome" defaultValue="OPERATOR_ASSISTED" aria-invalid={Boolean(state.fieldErrors?.outcome)} aria-describedby={state.fieldErrors?.outcome ? "support-outcome-error" : undefined}>
            {SUPPORT_INCIDENT_OUTCOMES.map((value) => <option key={value} value={value}>{friendly(value)}</option>)}
          </select>
          {state.fieldErrors?.outcome && <small id="support-outcome-error">{state.fieldErrors.outcome}</small>}
        </label>
        <label>
          <span>Incident date</span>
          <input name="incidentDate" type="date" defaultValue={today} max={today} required aria-invalid={Boolean(state.fieldErrors?.incidentDate)} aria-describedby={state.fieldErrors?.incidentDate ? "support-date-error" : undefined} />
          {state.fieldErrors?.incidentDate && <small id="support-date-error">{state.fieldErrors.incidentDate}</small>}
        </label>
        <label>
          <span>Support minutes</span>
          <input name="minutes" type="number" defaultValue="15" min="0" max="1440" step="1" inputMode="numeric" required aria-invalid={Boolean(state.fieldErrors?.minutes)} aria-describedby={state.fieldErrors?.minutes ? "support-minutes-error" : undefined} />
          {state.fieldErrors?.minutes && <small id="support-minutes-error">{state.fieldErrors.minutes}</small>}
        </label>
        <div className={styles.footer}>
          <SubmitButton />
          <p className={state.success ? styles.success : styles.error} role="status" aria-live="polite">{state.message}</p>
        </div>
      </form>
    </section>
  );
}
