import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  getAccountSecurityOverview,
  type AccountSecurityContext,
} from "@/server/auth/accountSecurity";
import { requireRequestCapability } from "@/server/auth/requestAuthorization";
import { getPrismaSessionService } from "@/server/auth/prismaSessionRepository";
import { SESSION_COOKIE_NAME } from "@/server/auth/sessionService";

import { AccountSecurityPanel } from "./account-security-panel";
import styles from "./account.module.css";

export const dynamic = "force-dynamic";

export default async function AccountSettingsPage() {
  const requestContext = await requireRequestCapability("organization.read");
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token || requestContext.authenticationMethod !== "session") {
    redirect("/login?returnTo=/settings/account");
  }

  let session;
  try {
    session = await getPrismaSessionService().resolveSession(token);
  } catch {
    redirect("/login?returnTo=/settings/account");
  }
  if (
    session.userId !== requestContext.actorId
    || session.organizationId !== requestContext.organizationId
    || session.campusId !== requestContext.campusId
  ) {
    redirect("/login?returnTo=/settings/account");
  }

  const securityContext: AccountSecurityContext = {
    actorUserId: requestContext.actorId,
    organizationId: requestContext.organizationId,
    campusId: requestContext.campusId,
    currentSessionId: session.sessionId,
  };
  const overview = await getAccountSecurityOverview(securityContext);

  return (
    <main className={`container stack-lg ${styles.shell}`}>
      <header className={styles.hero}>
        <div className="stack-sm">
          <p className="kicker">Account &amp; security</p>
          <h1>Your identity stays in your hands.</h1>
          <p>
            Keep your profile current, strengthen sign-in, and review every
            active SermonClip session from one private place.
          </p>
        </div>
        <div className={styles.securityScore}>
          <span>Sign-in protection</span>
          <strong>{overview.mfa.enabled ? "Strong" : "Standard"}</strong>
          <small>
            {overview.mfa.enabled
              ? "Password + authenticator"
              : "Add an authenticator for stronger protection"}
          </small>
        </div>
      </header>

      <AccountSecurityPanel initialOverview={overview} />
    </main>
  );
}
