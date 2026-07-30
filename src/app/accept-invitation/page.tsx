import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Join your church workspace",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type InvitationParams = {
  token?: string;
  error?: string;
};

const ERROR_MESSAGES: Record<string, string> = {
  invalid_invitation:
    "This invitation is invalid or has already been used.",
  expired_invitation:
    "This invitation has expired. Ask your workspace owner for a new one.",
  existing_account:
    "This email already has an account. Sign in first, then ask the owner to resend the invitation.",
  invalid_profile:
    "Enter your name and a password containing at least 12 characters.",
  temporarily_unavailable:
    "We could not complete the invitation right now. Please try again.",
};

export default async function AcceptInvitationPage({
  searchParams,
}: {
  searchParams: Promise<InvitationParams>;
}) {
  const params = await searchParams;
  const token = params.token?.trim() ?? "";
  const error = params.error ? ERROR_MESSAGES[params.error] : null;

  return (
    <main className="auth-page">
      <section
        className="auth-card card stack-lg"
        aria-labelledby="invitation-title"
      >
        <div className="stack-sm">
          <p className="kicker">Team invitation</p>
          <h1 id="invitation-title">Join your church workspace</h1>
          <p className="muted">
            Create your secure account. Your role and campus access come from
            the invitation and cannot be changed here.
          </p>
        </div>
        {error ? (
          <div className="notice tone-danger" role="alert">{error}</div>
        ) : null}
        {!token ? (
          <div className="notice tone-warning">
            Open the complete invitation link sent by your workspace owner.
          </div>
        ) : (
          <form
            action="/api/auth/invitations/accept"
            method="post"
            className="stack-md"
          >
            <input type="hidden" name="token" value={token} />
            <label className="field">
              <span>Your name</span>
              <input
                name="displayName"
                type="text"
                autoComplete="name"
                required
                minLength={2}
                maxLength={100}
              />
            </label>
            <label className="field">
              <span>Create a password</span>
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={1_024}
              />
              <small className="muted">
                Use at least 12 characters. A password manager is recommended.
              </small>
            </label>
            <button type="submit" className="button primary auth-submit">
              Accept invitation
            </button>
          </form>
        )}
        <p className="muted small">
          Already have access? <Link href="/login">Sign in</Link>
        </p>
      </section>
    </main>
  );
}
