"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import {
  saveYoutubeIntakeSettingsAction,
  type YoutubeIntakeSettingsActionState,
} from "./actions";
import styles from "./intake.module.css";

const initialState: YoutubeIntakeSettingsActionState = {
  success: false,
  message: "",
};

function cadenceValue(value: unknown): { postsPerWeek?: number; reviewDay?: string } {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as { postsPerWeek?: number; reviewDay?: string }
    : {};
}
function SaveButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button className={styles.primaryButton} type="submit" disabled={disabled || pending}>
      {pending ? "Saving intake settings…" : "Save intake settings"}
    </button>
  );
}

export function IntakeSettingsForm({
  accounts,
  settings,
  fallbackSpeakerName,
  fallbackLanguage,
  fallbackEmail,
  canManage,
}: {
  accounts: readonly {
    id: string;
    label: string;
    handle: string | null;
    status: string;
    credentialReady: boolean;
  }[];
  settings: {
    youtubeSocialAccountId: string | null;
    automaticYoutubeImportEnabled: boolean;
    youtubeRightsConfirmedAt: string | null;
    defaultSpeakerName: string | null;
    defaultLanguage: string;
    notificationEmail: string | null;
    weeklyCadenceJson: unknown;
  } | null;
  fallbackSpeakerName: string;
  fallbackLanguage: string;
  fallbackEmail: string;
  canManage: boolean;
}) {
  const [state, action] = useActionState(saveYoutubeIntakeSettingsAction, initialState);
  const [automaticEnabled, setAutomaticEnabled] = useState(
    settings?.automaticYoutubeImportEnabled === true,
  );
  const connectedAccounts = accounts.filter((account) => (
    account.status === "CONNECTED" && account.credentialReady
  ));
  const cadence = cadenceValue(settings?.weeklyCadenceJson);
  const formDisabled = !canManage || connectedAccounts.length === 0;

  return (
    <form action={action} className={styles.form}>
      {connectedAccounts.length === 0 ? (
        <div className={styles.emptyConnection}>
          <strong>No authorized YouTube channel</strong>
          <p>Connect the church channel before saving automatic intake settings.</p>
          <Link href="/settings/social">Connect YouTube →</Link>
        </div>
      ) : null}

      <label className={`${styles.field} ${styles.fullField}`}>
        <span>Church YouTube channel</span>
        <select
          name="youtubeSocialAccountId"
          defaultValue={settings?.youtubeSocialAccountId || connectedAccounts[0]?.id || ""}
          disabled={formDisabled}
          required
          aria-invalid={Boolean(state.fieldErrors?.youtubeSocialAccountId)}
        >
          {connectedAccounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.label}{account.handle ? ` · ${account.handle}` : ""}
            </option>
          ))}
        </select>
        {state.fieldErrors?.youtubeSocialAccountId ? <small className={styles.fieldError}>{state.fieldErrors.youtubeSocialAccountId}</small> : null}
      </label>

      <label className={styles.field}>
        <span>Default preacher</span>
        <input
          name="defaultSpeakerName"
          defaultValue={settings?.defaultSpeakerName || fallbackSpeakerName}
          disabled={formDisabled}
          required
        />
      </label>

      <label className={styles.field}>
        <span>Default language</span>
        <select
          name="defaultLanguage"
          defaultValue={settings?.defaultLanguage || fallbackLanguage}
          disabled={formDisabled}
        >
          <option value="en">English</option>
          <option value="af">Afrikaans</option>
          <option value="es">Spanish</option>
          <option value="fr">French</option>
          <option value="pt">Portuguese</option>
          <option value="sw">Swahili</option>
          <option value="xh">isiXhosa</option>
          <option value="zu">isiZulu</option>
        </select>
      </label>

      <label className={`${styles.field} ${styles.fullField}`}>
        <span>Completion notification email</span>
        <input
          name="notificationEmail"
          type="email"
          defaultValue={settings?.notificationEmail || fallbackEmail}
          disabled={formDisabled}
          required
          placeholder="media@yourchurch.org"
        />
        <small>
          The address is saved for workflow delivery. Dashboard progress remains
          the source of truth until email delivery is configured.
        </small>
        {state.fieldErrors?.notificationEmail ? <small className={styles.fieldError}>{state.fieldErrors.notificationEmail}</small> : null}
      </label>

      <label className={styles.field}>
        <span>Content pieces per week</span>
        <select
          name="postsPerWeek"
          defaultValue={String(cadence.postsPerWeek ?? 5)}
          disabled={formDisabled}
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
          disabled={formDisabled}
        >
          {["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"].map((day) => (
            <option key={day} value={day}>{day.charAt(0) + day.slice(1).toLowerCase()}</option>
          ))}
        </select>
      </label>

      <label className={`${styles.consent} ${state.fieldErrors?.rightsConfirmed ? styles.consentError : ""}`}>
        <input
          name="rightsConfirmed"
          type="checkbox"
          defaultChecked={Boolean(settings?.youtubeRightsConfirmedAt)}
          disabled={formDisabled}
        />
        <span>
          <strong>I confirm that our church may process future public sermon recordings from this channel.</strong>
          <small>
            Consent applies from the confirmation time forward. Private,
            unlisted, short, and pre-consent videos are not automatically imported.
          </small>
        </span>
      </label>
      {state.fieldErrors?.rightsConfirmed ? <p className={styles.fieldError}>{state.fieldErrors.rightsConfirmed}</p> : null}

      <label className={styles.automationToggle}>
        <span>
          <strong>Automatic YouTube sermon intake</strong>
          <small>
            When enabled, the persistent media worker checks the connected
            channel and creates a sermon project for each eligible new public sermon.
          </small>
        </span>
        <input
          name="automaticYoutubeImportEnabled"
          type="checkbox"
          checked={automaticEnabled}
          onChange={(event) => setAutomaticEnabled(event.target.checked)}
          disabled={formDisabled}
        />
      </label>

      <div className={styles.formFooter}>
        <SaveButton disabled={formDisabled} />
        <span>
          {automaticEnabled
            ? "Saving enables scanning; verify a recent scan below before relying on it."
            : "Settings can be prepared while automatic scanning stays off."}
        </span>
      </div>

      {state.message ? (
        <p
          className={state.success ? styles.successMessage : styles.errorMessage}
          role="status"
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
