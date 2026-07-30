import Link from "next/link";

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const { sent } = await searchParams;
  return (
    <main className="auth-page">
      <section className="auth-card card stack-lg" aria-labelledby="reset-request-title">
        <div className="stack-sm">
          <p className="kicker">Account recovery</p>
          <h1 id="reset-request-title">Reset your password</h1>
          <p className="muted">
            Enter your account email. If a matching account and secure email
            delivery are available, we will send a link that expires in 30 minutes.
          </p>
        </div>
        {sent === "1" ? (
          <div className="notice tone-success" role="status">
            Check your inbox if the address belongs to an active account. For
            privacy, we do not confirm whether an account exists.
          </div>
        ) : null}
        <form action="/api/auth/password-reset/request" method="post" className="stack-md">
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
          <button type="submit" className="button primary auth-submit">
            Send secure reset link
          </button>
        </form>
        <p className="muted small">
          <Link href="/login">Return to sign in</Link>
        </p>
      </section>
    </main>
  );
}
