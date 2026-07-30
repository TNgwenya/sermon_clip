"use client";

import { useState } from "react";

import type { AccountSecurityOverview } from "@/server/auth/accountSecurity";

import styles from "./account.module.css";

type Notice = {
  tone: "success" | "error";
  message: string;
};

type Enrollment = {
  factorId: string;
  secret: string;
  otpauthUri: string;
  expiresAt: string;
};

async function accountMutation(
  url: string,
  method: "POST" | "DELETE",
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const result = await response.json().catch(() => null) as {
    message?: unknown;
  } | null;
  if (!response.ok) {
    throw new Error(
      typeof result?.message === "string"
        ? result.message
        : "The security change could not be completed.",
    );
  }
  return result as Record<string, unknown>;
}

function readableDate(value: string | null): string {
  if (!value) return "Not available";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function AccountSecurityPanel({
  initialOverview,
}: {
  initialOverview: AccountSecurityOverview;
}) {
  const [profile, setProfile] = useState(initialOverview.profile);
  const [mfa, setMfa] = useState(initialOverview.mfa);
  const [sessions, setSessions] = useState([...initialOverview.sessions]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<readonly string[] | null>(
    null,
  );
  const [copyLabel, setCopyLabel] = useState("Copy all codes");

  function showError(error: unknown) {
    setNotice({
      tone: "error",
      message: error instanceof Error
        ? error.message
        : "The security change could not be completed.",
    });
  }

  async function saveProfile(formData: FormData) {
    setBusy("profile");
    setNotice(null);
    try {
      const result = await accountMutation(
        "/api/settings/account/profile",
        "POST",
        {
          displayName: String(formData.get("displayName") ?? ""),
          firstName: String(formData.get("firstName") ?? ""),
          lastName: String(formData.get("lastName") ?? ""),
          jobTitle: String(formData.get("jobTitle") ?? ""),
          phone: String(formData.get("phone") ?? ""),
          timezone: String(formData.get("timezone") ?? ""),
        },
      );
      setProfile(result.profile as AccountSecurityOverview["profile"]);
      setNotice({ tone: "success", message: "Profile saved." });
    } catch (error) {
      showError(error);
    } finally {
      setBusy(null);
    }
  }

  async function changePassword(formData: FormData) {
    const currentPassword = String(formData.get("currentPassword") ?? "");
    const newPassword = String(formData.get("newPassword") ?? "");
    const confirmation = String(formData.get("confirmPassword") ?? "");
    if (newPassword !== confirmation) {
      setNotice({ tone: "error", message: "The new passwords do not match." });
      return;
    }

    setBusy("password");
    setNotice(null);
    try {
      const result = await accountMutation(
        "/api/settings/account/password",
        "POST",
        { currentPassword, newPassword },
      );
      const revoked = Number(result.revokedSessions ?? 0);
      setSessions((current) => current.filter((session) => session.current));
      setNotice({
        tone: "success",
        message: revoked > 0
          ? `Password changed. ${revoked} other session${revoked === 1 ? "" : "s"} signed out.`
          : "Password changed.",
      });
      const form = document.getElementById(
        "account-password-form",
      ) as HTMLFormElement | null;
      form?.reset();
    } catch (error) {
      showError(error);
    } finally {
      setBusy(null);
    }
  }

  async function beginMfa(formData: FormData) {
    setBusy("mfa-start");
    setNotice(null);
    setRecoveryCodes(null);
    try {
      const result = await accountMutation(
        "/api/settings/account/mfa/enrollment",
        "POST",
        { currentPassword: String(formData.get("currentPassword") ?? "") },
      );
      setEnrollment(result.enrollment as Enrollment);
      setNotice({
        tone: "success",
        message: "Authenticator setup started. Verify one code to finish.",
      });
    } catch (error) {
      showError(error);
    } finally {
      setBusy(null);
    }
  }

  async function verifyMfa(formData: FormData) {
    if (!enrollment) return;
    setBusy("mfa-verify");
    setNotice(null);
    try {
      const result = await accountMutation(
        "/api/settings/account/mfa/verify",
        "POST",
        {
          factorId: enrollment.factorId,
          code: String(formData.get("code") ?? ""),
        },
      );
      const codes = result.recoveryCodes as readonly string[];
      setMfa({
        enabled: true,
        enabledAt: new Date().toISOString(),
        recoveryCodesRemaining: codes.length,
      });
      setEnrollment(null);
      setRecoveryCodes(codes);
      setCopyLabel("Copy all codes");
      setSessions((current) => current.filter((session) => session.current));
      setNotice({
        tone: "success",
        message: "Two-step verification is on. Save the recovery codes now.",
      });
    } catch (error) {
      showError(error);
    } finally {
      setBusy(null);
    }
  }

  async function copyRecoveryCodes() {
    if (!recoveryCodes) return;
    try {
      await navigator.clipboard.writeText(recoveryCodes.join("\n"));
      setCopyLabel("Copied");
    } catch {
      setCopyLabel("Select and copy each code");
    }
  }

  async function disableMfa(formData: FormData) {
    if (!window.confirm(
      "Turn off two-step verification? Other signed-in devices will be signed out.",
    )) return;
    setBusy("mfa-disable");
    setNotice(null);
    try {
      await accountMutation(
        "/api/settings/account/mfa/disable",
        "POST",
        {
          currentPassword: String(formData.get("currentPassword") ?? ""),
          authenticationCode: String(
            formData.get("authenticationCode") ?? "",
          ),
        },
      );
      setMfa({
        enabled: false,
        enabledAt: null,
        recoveryCodesRemaining: 0,
      });
      setRecoveryCodes(null);
      setSessions((current) => current.filter((session) => session.current));
      setNotice({
        tone: "success",
        message: "Two-step verification is off. Other sessions were signed out.",
      });
    } catch (error) {
      showError(error);
    } finally {
      setBusy(null);
    }
  }

  async function revokeSession(
    session: AccountSecurityOverview["sessions"][number],
  ) {
    const prompt = session.current
      ? "Sign out this session now?"
      : "Sign out this device?";
    if (!window.confirm(prompt)) return;
    setBusy(`session:${session.id}`);
    setNotice(null);
    try {
      const result = await accountMutation(
        `/api/settings/account/sessions/${encodeURIComponent(session.id)}`,
        "DELETE",
      );
      if (result.revokedCurrentSession === true) {
        window.location.assign("/login");
        return;
      }
      setSessions((current) => current.filter(({ id }) => id !== session.id));
      setNotice({ tone: "success", message: "Session signed out." });
    } catch (error) {
      showError(error);
    } finally {
      setBusy(null);
    }
  }

  async function signOutEverywhere(formData: FormData) {
    if (!window.confirm(
      "Sign out every SermonClip session, including this one?",
    )) return;
    setBusy("sessions-all");
    setNotice(null);
    try {
      await accountMutation(
        "/api/settings/account/sessions/revoke-all",
        "POST",
        { currentPassword: String(formData.get("currentPassword") ?? "") },
      );
      window.location.assign("/login");
    } catch (error) {
      showError(error);
      setBusy(null);
    }
  }

  return (
    <div className={styles.layout}>
      <div className={styles.noticeRegion} aria-live="polite">
        {notice ? (
          <div
            className={`${styles.notice} ${
              notice.tone === "success"
                ? styles.noticeSuccess
                : styles.noticeError
            }`}
            role={notice.tone === "error" ? "alert" : "status"}
          >
            {notice.message}
          </div>
        ) : null}
      </div>

      <section className={styles.card} aria-labelledby="profile-heading">
        <div className={styles.cardHeading}>
          <div>
            <p className="kicker">Your profile</p>
            <h2 id="profile-heading">How your team sees you</h2>
          </div>
          <span className={styles.statusPill}>Private account</span>
        </div>
        <form
          className={styles.formGrid}
          action={(formData) => void saveProfile(formData)}
        >
          <label className={`${styles.field} ${styles.fullField}`}>
            <span>Email</span>
            <input value={profile.email} readOnly aria-readonly="true" />
            <small>Contact an organization owner to change your sign-in email.</small>
          </label>
          <label className={`${styles.field} ${styles.fullField}`}>
            <span>Display name</span>
            <input
              name="displayName"
              defaultValue={profile.displayName}
              autoComplete="name"
              maxLength={100}
              required
            />
          </label>
          <label className={styles.field}>
            <span>First name</span>
            <input
              name="firstName"
              defaultValue={profile.firstName}
              autoComplete="given-name"
              maxLength={100}
            />
          </label>
          <label className={styles.field}>
            <span>Last name</span>
            <input
              name="lastName"
              defaultValue={profile.lastName}
              autoComplete="family-name"
              maxLength={100}
            />
          </label>
          <label className={styles.field}>
            <span>Ministry role or title</span>
            <input
              name="jobTitle"
              defaultValue={profile.jobTitle}
              autoComplete="organization-title"
              maxLength={120}
              placeholder="Communications director"
            />
          </label>
          <label className={styles.field}>
            <span>Phone</span>
            <input
              name="phone"
              defaultValue={profile.phone}
              autoComplete="tel"
              maxLength={40}
            />
          </label>
          <label className={`${styles.field} ${styles.fullField}`}>
            <span>Timezone</span>
            <input
              name="timezone"
              defaultValue={profile.timezone}
              maxLength={100}
              placeholder="Africa/Johannesburg"
              aria-describedby="timezone-help"
            />
            <small id="timezone-help">
              Use an IANA timezone, for example America/New_York.
            </small>
          </label>
          <div className={`${styles.actions} ${styles.fullField}`}>
            <button
              className={styles.primaryButton}
              type="submit"
              disabled={busy !== null}
            >
              {busy === "profile" ? "Saving…" : "Save profile"}
            </button>
          </div>
        </form>
      </section>

      <section className={styles.card} aria-labelledby="password-heading">
        <div className={styles.cardHeading}>
          <div>
            <p className="kicker">Password</p>
            <h2 id="password-heading">Change your password</h2>
          </div>
          <small className={styles.lastChanged}>
            Last changed {readableDate(initialOverview.passwordChangedAt)}
          </small>
        </div>
        <p className={styles.supportingCopy}>
          Use at least 12 characters. Changing it keeps this session open and
          signs out every other device.
        </p>
        <form
          id="account-password-form"
          className={styles.formGrid}
          action={(formData) => void changePassword(formData)}
        >
          <label className={`${styles.field} ${styles.fullField}`}>
            <span>Current password</span>
            <input
              type="password"
              name="currentPassword"
              autoComplete="current-password"
              required
            />
          </label>
          <label className={styles.field}>
            <span>New password</span>
            <input
              type="password"
              name="newPassword"
              autoComplete="new-password"
              minLength={12}
              required
            />
          </label>
          <label className={styles.field}>
            <span>Confirm new password</span>
            <input
              type="password"
              name="confirmPassword"
              autoComplete="new-password"
              minLength={12}
              required
            />
          </label>
          <div className={`${styles.actions} ${styles.fullField}`}>
            <button
              className={styles.primaryButton}
              type="submit"
              disabled={busy !== null}
            >
              {busy === "password" ? "Changing…" : "Change password"}
            </button>
          </div>
        </form>
      </section>

      <section className={styles.card} aria-labelledby="mfa-heading">
        <div className={styles.cardHeading}>
          <div>
            <p className="kicker">Two-step verification</p>
            <h2 id="mfa-heading">Authenticator app</h2>
          </div>
          <span
            className={`${styles.statusPill} ${
              mfa.enabled ? styles.statusStrong : styles.statusStandard
            }`}
          >
            {mfa.enabled ? "On" : "Off"}
          </span>
        </div>

        {recoveryCodes ? (
          <div className={styles.recoveryPanel} role="status">
            <div>
              <strong>Save these recovery codes now</strong>
              <p>
                Each code works once. SermonClip stores only protected hashes,
                so these codes cannot be shown again.
              </p>
            </div>
            <ul className={styles.recoveryGrid} aria-label="Recovery codes">
              {recoveryCodes.map((code) => <li key={code}><code>{code}</code></li>)}
            </ul>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => void copyRecoveryCodes()}
              >
                {copyLabel}
              </button>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => setRecoveryCodes(null)}
              >
                I saved them
              </button>
            </div>
          </div>
        ) : mfa.enabled ? (
          <div className={styles.mfaEnabled}>
            <p>
              Enabled {readableDate(mfa.enabledAt)} ·{" "}
              {mfa.recoveryCodesRemaining} unused recovery code
              {mfa.recoveryCodesRemaining === 1 ? "" : "s"}.
            </p>
            <details className={styles.dangerDisclosure}>
              <summary>Turn off two-step verification</summary>
              <form
                className={styles.formGrid}
                action={(formData) => void disableMfa(formData)}
              >
                <label className={styles.field}>
                  <span>Current password</span>
                  <input
                    type="password"
                    name="currentPassword"
                    autoComplete="current-password"
                    required
                  />
                </label>
                <label className={styles.field}>
                  <span>Authenticator or recovery code</span>
                  <input
                    name="authenticationCode"
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    required
                  />
                </label>
                <div className={`${styles.actions} ${styles.fullField}`}>
                  <button
                    type="submit"
                    className={styles.dangerButton}
                    disabled={busy !== null}
                  >
                    {busy === "mfa-disable" ? "Turning off…" : "Turn off"}
                  </button>
                </div>
              </form>
            </details>
          </div>
        ) : enrollment ? (
          <div className={styles.enrollmentPanel}>
            <ol className={styles.steps}>
              <li>
                <strong>Add SermonClip to your authenticator</strong>
                <span>
                  Open the link on a phone or enter the setup key manually.
                </span>
              </li>
              <li>
                <strong>Verify one six-digit code</strong>
                <span>This setup expires {readableDate(enrollment.expiresAt)}.</span>
              </li>
            </ol>
            <div className={styles.secretBox}>
              <span>Manual setup key</span>
              <code>{enrollment.secret}</code>
              <a href={enrollment.otpauthUri} className={styles.openAppLink}>
                Open authenticator app
              </a>
            </div>
            <form
              className={styles.inlineForm}
              action={(formData) => void verifyMfa(formData)}
            >
              <label className={styles.field}>
                <span>Six-digit code</span>
                <input
                  name="code"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  autoFocus
                />
              </label>
              <button
                type="submit"
                className={styles.primaryButton}
                disabled={busy !== null}
              >
                {busy === "mfa-verify" ? "Verifying…" : "Verify and turn on"}
              </button>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => setEnrollment(null)}
              >
                Cancel
              </button>
            </form>
          </div>
        ) : (
          <form
            className={styles.enableMfa}
            action={(formData) => void beginMfa(formData)}
          >
            <p className={styles.supportingCopy}>
              Require a six-digit code after your password. Setup starts only
              after we verify your current password.
            </p>
            <label className={styles.field}>
              <span>Current password</span>
              <input
                type="password"
                name="currentPassword"
                autoComplete="current-password"
                required
              />
            </label>
            <div className={styles.actions}>
              <button
                type="submit"
                className={styles.primaryButton}
                disabled={busy !== null}
              >
                {busy === "mfa-start" ? "Starting…" : "Set up authenticator"}
              </button>
            </div>
          </form>
        )}
      </section>

      <section className={styles.card} aria-labelledby="sessions-heading">
        <div className={styles.cardHeading}>
          <div>
            <p className="kicker">Devices &amp; sessions</p>
            <h2 id="sessions-heading">Where you’re signed in</h2>
          </div>
          <span className={styles.statusPill}>{sessions.length} active</span>
        </div>
        <div className={styles.sessionList}>
          {sessions.map((session) => (
            <article className={styles.sessionRow} key={session.id}>
              <span className={styles.deviceIcon} aria-hidden="true">
                {session.current ? "●" : "○"}
              </span>
              <div>
                <strong>
                  {session.current ? "This browser" : "Signed-in session"}
                </strong>
                <span>Last active {readableDate(session.lastSeenAt)}</span>
                <small>
                  Started {readableDate(session.createdAt)} · Expires{" "}
                  {readableDate(session.absoluteExpiresAt)}
                </small>
              </div>
              {session.current ? (
                <span className={`${styles.statusPill} ${styles.statusStrong}`}>
                  Current
                </span>
              ) : null}
              <button
                type="button"
                className={
                  session.current
                    ? styles.secondaryButton
                    : styles.dangerButton
                }
                disabled={busy !== null}
                onClick={() => void revokeSession(session)}
              >
                {busy === `session:${session.id}` ? "Signing out…" : "Sign out"}
              </button>
            </article>
          ))}
        </div>

        <details className={styles.dangerDisclosure}>
          <summary>Sign out everywhere</summary>
          <form
            className={styles.signOutAll}
            action={(formData) => void signOutEverywhere(formData)}
          >
            <p>
              This ends every session, including this one. Enter your password
              to continue.
            </p>
            <label className={styles.field}>
              <span>Current password</span>
              <input
                type="password"
                name="currentPassword"
                autoComplete="current-password"
                required
              />
            </label>
            <button
              type="submit"
              className={styles.dangerButton}
              disabled={busy !== null}
            >
              {busy === "sessions-all" ? "Signing out…" : "Sign out everywhere"}
            </button>
          </form>
        </details>
      </section>
    </div>
  );
}
