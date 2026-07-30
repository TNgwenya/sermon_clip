import Link from "next/link";

type LoginSearchParams = {
  error?: string;
  returnTo?: string;
  reset?: string;
};

const ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials:
    "We could not verify those details. Check your email, password, and authentication code.",
  mfa_required:
    "This account uses two-step verification. Enter the six-digit code from your authenticator.",
  workspace_required:
    "This account belongs to more than one church. Enter the church workspace name to continue.",
  temporarily_unavailable:
    "Sign-in is temporarily unavailable. Please try again in a moment.",
};

function safeReturnPath(value: string | undefined): string {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<LoginSearchParams>;
}) {
  const params = await searchParams;
  const errorMessage = params.error ? ERROR_MESSAGES[params.error] : null;
  const returnTo = safeReturnPath(params.returnTo);

  return (
    <main className="auth-page">
      <section className="auth-card card stack-lg" aria-labelledby="login-title">
        <div className="stack-sm">
          <p className="kicker">Church workspace</p>
          <h1 id="login-title">Welcome back</h1>
          <p className="muted">
            Review this week&apos;s sermon content, collaborate with your team,
            and publish with confidence.
          </p>
        </div>

        {errorMessage ? (
          <div className="notice tone-danger" role="alert">{errorMessage}</div>
        ) : null}
        {params.reset === "complete" ? (
          <div className="notice tone-success" role="status">
            Your password has been changed and other sessions were signed out.
            Sign in with your new password.
          </div>
        ) : null}

        <form action="/api/auth/login" method="post" className="stack-md">
          <input type="hidden" name="returnTo" value={returnTo} />
          <label className="field">
            <span>Email</span>
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={320}
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={1_024}
            />
          </label>
          <details className="auth-options">
            <summary>Workspace or two-step verification</summary>
            <div className="stack-md">
              <label className="field">
                <span>Church workspace</span>
                <input
                  name="organization"
                  type="text"
                  autoComplete="organization"
                  placeholder="hope-church"
                />
              </label>
              <label className="field">
                <span>Campus (optional)</span>
                <input name="campus" type="text" placeholder="north" />
              </label>
              <label className="field">
                <span>Six-digit authentication code</span>
                <input
                  name="totpCode"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                />
              </label>
              <label className="field">
                <span>Recovery code</span>
                <input
                  name="recoveryCode"
                  type="text"
                  autoComplete="off"
                  placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
                />
              </label>
            </div>
          </details>
          <button type="submit" className="button primary auth-submit">
            Sign in securely
          </button>
        </form>

        <p className="muted small">
          <Link href="/forgot-password">Forgot your password?</Link>
          {" · "}
          Need access? Ask your church workspace owner for an invitation.{" "}
          <Link href="/privacy">Privacy</Link>
        </p>
      </section>
    </main>
  );
}
