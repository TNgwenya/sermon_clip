import Link from "next/link";

const ERROR_MESSAGES: Record<string, string> = {
  password_mismatch: "The two passwords do not match.",
  invalid_password: "Choose a password containing at least 12 characters.",
  invalid_token: "This reset link is invalid or has already been used.",
  expired_token: "This reset link has expired. Request a new one.",
  temporarily_unavailable: "Password reset is temporarily unavailable.",
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const params = await searchParams;
  const token = params.token?.trim() ?? "";
  const error = params.error ? ERROR_MESSAGES[params.error] : null;
  return (
    <main className="auth-page">
      <section className="auth-card card stack-lg" aria-labelledby="reset-title">
        <div className="stack-sm">
          <p className="kicker">Account recovery</p>
          <h1 id="reset-title">Choose a new password</h1>
          <p className="muted">
            Your other SermonClip sessions will be signed out when this password changes.
          </p>
        </div>
        {error ? <div className="notice tone-danger" role="alert">{error}</div> : null}
        {token ? (
          <form action="/api/auth/password-reset/complete" method="post" className="stack-md">
            <input type="hidden" name="token" value={token} />
            <label className="field">
              <span>New password</span>
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={1_024}
                required
              />
            </label>
            <label className="field">
              <span>Confirm new password</span>
              <input
                name="passwordConfirmation"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={1_024}
                required
              />
            </label>
            <button type="submit" className="button primary auth-submit">
              Change password securely
            </button>
          </form>
        ) : (
          <div className="notice tone-warning" role="alert">
            This reset link cannot be used. Request a new secure link.
          </div>
        )}
        <p className="muted small">
          <Link href="/forgot-password">Request another link</Link>
          {" · "}
          <Link href="/login">Return to sign in</Link>
        </p>
      </section>
    </main>
  );
}
