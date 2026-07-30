"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  saveWorkflowDefaultsAction,
  type WorkflowDefaultsActionState,
} from "./actions";
import styles from "./onboarding.module.css";

const initialState: WorkflowDefaultsActionState = {
  success: false,
  message: "",
};

type CadenceValue = {
  postsPerWeek?: number;
  reviewDay?: string;
};

function parseCadence(value: unknown): CadenceValue {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as CadenceValue
    : {};
}

function SaveButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button className={styles.primaryButton} type="submit" disabled={disabled || pending}>
      {pending ? "Saving rhythm…" : "Save weekly rhythm"}
    </button>
  );
}

export function WorkflowDefaultsForm({
  settings,
  fallbackSpeakerName,
  fallbackEmail,
  canManage,
}: {
  settings: {
    defaultSpeakerName: string | null;
    notificationEmail: string | null;
    weeklyCadenceJson: unknown;
  } | null;
  fallbackSpeakerName: string;
  fallbackEmail: string;
  canManage: boolean;
}) {
  const [state, action] = useActionState(saveWorkflowDefaultsAction, initialState);
  const cadence = parseCadence(settings?.weeklyCadenceJson);

  return (
    <form action={action} className={styles.identityForm}>
      <label className={styles.field}>
        <span>Default preacher</span>
        <input
          name="defaultSpeakerName"
          defaultValue={settings?.defaultSpeakerName || fallbackSpeakerName}
          disabled={!canManage}
          required
          aria-invalid={Boolean(state.fieldErrors?.defaultSpeakerName)}
        />
        {state.fieldErrors?.defaultSpeakerName ? <small className={styles.fieldError}>{state.fieldErrors.defaultSpeakerName}</small> : null}
      </label>

      <label className={styles.field}>
        <span>Content pieces per week</span>
        <select
          name="postsPerWeek"
          defaultValue={String(cadence.postsPerWeek ?? 5)}
          disabled={!canManage}
        >
          {[3, 4, 5, 6, 7, 10, 14].map((count) => (
            <option key={count} value={count}>{count} pieces</option>
          ))}
        </select>
      </label>

      <label className={styles.field}>
        <span>Team review day</span>
        <select
          name="reviewDay"
          defaultValue={cadence.reviewDay ?? "MONDAY"}
          disabled={!canManage}
        >
          {["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"].map((day) => (
            <option key={day} value={day}>{day.charAt(0) + day.slice(1).toLowerCase()}</option>
          ))}
        </select>
      </label>

      <label className={`${styles.field} ${styles.fullField}`}>
        <span>Completion email <small>(delivery is not active yet)</small></span>
        <input
          name="notificationEmail"
          type="email"
          defaultValue={settings?.notificationEmail || fallbackEmail}
          disabled={!canManage}
          placeholder="media@yourchurch.org"
          aria-invalid={Boolean(state.fieldErrors?.notificationEmail)}
        />
        <small>
          This saves who should be notified. Until email delivery is configured,
          live progress and completion remain visible in the dashboard.
        </small>
        {state.fieldErrors?.notificationEmail ? <small className={styles.fieldError}>{state.fieldErrors.notificationEmail}</small> : null}
      </label>

      <div className={styles.formFooter}>
        <SaveButton disabled={!canManage} />
        {state.message ? (
          <p className={state.success ? styles.successMessage : styles.errorMessage} role="status">
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
