import Link from "next/link";

import {
  canPersistedTenantCapability,
  requireRequestCapability,
} from "@/server/auth/requestAuthorization";
import {
  listOrganizationTeamDirectory,
} from "@/server/organizations/teamDirectory";

import { TeamAdminPanel } from "./team-admin-panel";
import styles from "./team.module.css";

export const dynamic = "force-dynamic";

export default async function TeamSettingsPage() {
  const requestContext = await requireRequestCapability("members.read");
  const [canManageMembers, canManageInvitations] = await Promise.all([
    canPersistedTenantCapability(requestContext, "members.manage"),
    canPersistedTenantCapability(requestContext, "invitations.manage"),
  ]);
  const directory = await listOrganizationTeamDirectory(
    {
      organizationId: requestContext.organizationId,
      campusId: requestContext.campusId,
    },
    { includeInvitations: canManageInvitations },
  );

  return (
    <main className={`container stack-lg ${styles.shell}`}>
      <header className={styles.hero}>
        <div className="stack-sm">
          <p className="kicker">Team &amp; access</p>
          <h1>Give every person the right seat.</h1>
          <p className={styles.heroCopy}>
            Invite staff, keep church and campus responsibilities clear, and
            safely hand work over when somebody leaves.
          </p>
        </div>
        <div className={styles.scopeCard}>
          <span>Active workspace</span>
          <strong>{directory.organization.name}</strong>
          <small>
            {requestContext.campusId
              ? directory.campuses[0]?.name ?? "Selected campus"
              : "All campuses"}
          </small>
        </div>
      </header>

      <TeamAdminPanel
        directory={directory}
        actorUserId={requestContext.actorId}
        selectedCampusId={requestContext.campusId}
        canManageMembers={canManageMembers}
        canManageInvitations={canManageInvitations}
      />

      <Link href="/" className="text-link">
        Back to dashboard
      </Link>
    </main>
  );
}
