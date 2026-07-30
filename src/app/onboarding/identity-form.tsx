"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  saveChurchIdentityAction,
  type ChurchIdentityActionState,
} from "./actions";
import styles from "./onboarding.module.css";

const initialState: ChurchIdentityActionState = {
  success: false,
  message: "",
};

const TIMEZONES = [
  "Africa/Johannesburg",
  "Africa/Lagos",
  "Africa/Nairobi",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/New_York",
  "Asia/Manila",
  "Australia/Sydney",
  "Europe/London",
  "Pacific/Auckland",
  "UTC",
];

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "af", label: "Afrikaans" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "pt", label: "Portuguese" },
  { value: "sw", label: "Swahili" },
  { value: "xh", label: "isiXhosa" },
  { value: "zu", label: "isiZulu" },
];

function SaveButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button className={styles.primaryButton} type="submit" disabled={disabled || pending}>
      {pending ? "Saving identity…" : "Save church identity"}
    </button>
  );
}
export function IdentityForm({
  organization,
  canManage,
}: {
  organization: {
    name: string;
    timezone: string;
    defaultLanguage: string;
  };
  canManage: boolean;
}) {
  const [state, action] = useActionState(saveChurchIdentityAction, initialState);
  const timezones = TIMEZONES.includes(organization.timezone)
    ? TIMEZONES
    : [organization.timezone, ...TIMEZONES];
  const languages = LANGUAGES.some((language) => language.value === organization.defaultLanguage)
    ? LANGUAGES
    : [{ value: organization.defaultLanguage, label: organization.defaultLanguage }, ...LANGUAGES];

  return (
    <form action={action} className={styles.identityForm}>
      <label className={styles.field}>
        <span>Church name</span>
        <input
          name="name"
          defaultValue={organization.name}
          disabled={!canManage}
          required
          aria-invalid={Boolean(state.fieldErrors?.name)}
          aria-describedby={state.fieldErrors?.name ? "identity-name-error" : undefined}
        />
        {state.fieldErrors?.name ? <small id="identity-name-error" className={styles.fieldError}>{state.fieldErrors.name}</small> : null}
      </label>

      <label className={styles.field}>
        <span>Primary timezone</span>
        <select
          name="timezone"
          defaultValue={organization.timezone}
          disabled={!canManage}
          aria-invalid={Boolean(state.fieldErrors?.timezone)}
        >
          {timezones.map((timezone) => <option key={timezone} value={timezone}>{timezone.replace(/_/g, " ")}</option>)}
        </select>
        {state.fieldErrors?.timezone ? <small className={styles.fieldError}>{state.fieldErrors.timezone}</small> : null}
      </label>

      <label className={styles.field}>
        <span>Default sermon language</span>
        <select
          name="defaultLanguage"
          defaultValue={organization.defaultLanguage}
          disabled={!canManage}
          aria-invalid={Boolean(state.fieldErrors?.defaultLanguage)}
        >
          {languages.map((language) => <option key={language.value} value={language.value}>{language.label}</option>)}
        </select>
        {state.fieldErrors?.defaultLanguage ? <small className={styles.fieldError}>{state.fieldErrors.defaultLanguage}</small> : null}
      </label>

      <div className={styles.formFooter}>
        <SaveButton disabled={!canManage} />
        {!canManage ? <span>Ask an organization owner or administrator to make changes.</span> : null}
        {state.message ? (
          <p
            className={state.success ? styles.successMessage : styles.errorMessage}
            role="status"
          >
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
