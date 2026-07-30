"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import type {
  TeamDirectory,
  TeamDirectoryMember,
} from "@/server/organizations/teamDirectory";

import styles from "./team.module.css";

type TeamAdminPanelProps = {
  directory: TeamDirectory;
  actorUserId: string;
  selectedCampusId: string | null;
  canManageMembers: boolean;
  canManageInvitations: boolean;
};

type Notice = {
  tone: "success" | "error";
  message: string;
};

type InvitationSecret = {
  acceptUrl: string;
  expiresAt: string;
};

const ROLE_LABELS = {
  OWNER: "Owner",
  ORG_ADMIN: "Organization admin",
  CAMPUS_ADMIN: "Campus admin",
  PASTOR_APPROVER: "Pastor / approver",
  CONTENT_LEAD: "Content lead",
  EDITOR: "Editor",
  PUBLISHER: "Publisher",
  ANALYST: "Analyst",
  VIEWER: "Viewer",
  EXTERNAL_CONTRACTOR: "External contractor",
} as const;

const INVITABLE_ROLES = [
  "ORG_ADMIN",
  "CAMPUS_ADMIN",
  "PASTOR_APPROVER",
  "CONTENT_LEAD",
  "EDITOR",
  "PUBLISHER",
  "ANALYST",
  "VIEWER",
] as const;

function shortDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function memberScope(member: TeamDirectoryMember): string {
  return member.campusName ?? "Organization-wide";
}

async function teamMutation(
  url: string,
  init: RequestInit,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => null) as {
    message?: unknown;
  } | null;
  if (!response.ok) {
    throw new Error(
      typeof body?.message === "string"
        ? body.message
        : "The team change could not be completed.",
    );
  }
  return body as Record<string, unknown>;
}

export function TeamAdminPanel({
  directory,
  actorUserId,
  selectedCampusId,
  canManageMembers,
  canManageInvitations,
}: TeamAdminPanelProps) {
  const router = useRouter();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [invitationSecret, setInvitationSecret] =
    useState<InvitationSecret | null>(null);
  const [inviteCampusId, setInviteCampusId] = useState(
    selectedCampusId ?? "",
  );
  const [inviteRole, setInviteRole] = useState<string>(
    selectedCampusId ? "CAMPUS_ADMIN" : "CONTENT_LEAD",
  );
  const [copyLabel, setCopyLabel] = useState("Copy invitation link");

  const replacementCandidates = useMemo(() => {
    const users = new Map<string, TeamDirectoryMember>();
    for (const member of directory.members) {
      if (
        member.status === "ACTIVE"
        && member.role !== "OWNER"
        && !users.has(member.userId)
      ) {
        users.set(member.userId, member);
      }
    }
    return [...users.values()];
  }, [directory.members]);

  const roleOptions = INVITABLE_ROLES.filter((role) => (
    inviteCampusId
      ? role !== "ORG_ADMIN"
      : role !== "CAMPUS_ADMIN"
  ));

  async function issueInvitation(formData: FormData) {
    setBusyKey("invite");
    setNotice(null);
    setInvitationSecret(null);
    setCopyLabel("Copy invitation link");
    try {
      const response = await teamMutation(
        "/api/settings/team/invitations",
        {
          method: "POST",
          body: JSON.stringify({
            email: String(formData.get("email") ?? ""),
            role: inviteRole,
            campusId: inviteCampusId || null,
          }),
        },
      );
      const invitation = response.invitation as {
        acceptUrl?: unknown;
        expiresAt?: unknown;
      } | undefined;
      if (
        typeof invitation?.acceptUrl !== "string"
        || typeof invitation.expiresAt !== "string"
      ) {
        throw new Error("The invitation was created without a usable link.");
      }
      setInvitationSecret({
        acceptUrl: invitation.acceptUrl,
        expiresAt: invitation.expiresAt,
      });
      setNotice({
        tone: "success",
        message: "Invitation created. Copy the secure link before leaving this page.",
      });
      router.refresh();
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error
          ? error.message
          : "The invitation could not be created.",
      });
    } finally {
      setBusyKey(null);
    }
  }

  async function copyInvitationLink() {
    if (!invitationSecret) return;
    try {
      await navigator.clipboard.writeText(invitationSecret.acceptUrl);
      setCopyLabel("Copied");
    } catch {
      setCopyLabel("Select and copy the link");
    }
  }

  async function revokeInvitation(invitationId: string) {
    setBusyKey(`invitation:${invitationId}`);
    setNotice(null);
    try {
      await teamMutation(
        `/api/settings/team/invitations/${encodeURIComponent(invitationId)}`,
        { method: "DELETE" },
      );
      setNotice({ tone: "success", message: "Invitation revoked." });
      router.refresh();
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error
          ? error.message
          : "The invitation could not be revoked.",
      });
    } finally {
      setBusyKey(null);
    }
  }

  async function offboardMember(
    member: TeamDirectoryMember,
    replacementUserId: string,
  ) {
    const confirmed = window.confirm(
      replacementUserId
        ? `Remove ${member.displayName} and reassign their active work?`
        : `Remove ${member.displayName}? Their active assignments will be cancelled.`,
    );
    if (!confirmed) return;

    setBusyKey(`member:${member.membershipId}`);
    setNotice(null);
    try {
      await teamMutation(
        `/api/settings/team/members/${encodeURIComponent(member.membershipId)}/offboard`,
        {
          method: "POST",
          body: JSON.stringify({
            reassignRoleToUserId: replacementUserId || null,
          }),
        },
      );
      setNotice({
        tone: "success",
        message: `${member.displayName} was removed from this workspace.`,
      });
      router.refresh();
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error
          ? error.message
          : "The member could not be removed.",
      });
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className={styles.layout}>
      {notice ? (
        <div
          className={`${styles.notice} ${
            notice.tone === "success" ? styles.noticeSuccess : styles.noticeError
          }`}
          role={notice.tone === "error" ? "alert" : "status"}
        >
          {notice.message}
        </div>
      ) : null}

      {canManageInvitations ? (
        <section className={styles.card} aria-labelledby="invite-team-heading">
          <div className={styles.cardHeading}>
            <div>
              <p className="kicker">Invite securely</p>
              <h2 id="invite-team-heading">Add someone to the team</h2>
            </div>
            <span className={styles.stepBadge}>Link shown once</span>
          </div>

          <form
            className={styles.inviteForm}
            action={(formData) => void issueInvitation(formData)}
          >
            <label className={styles.field}>
              <span>Email address</span>
              <input
                type="email"
                name="email"
                autoComplete="email"
                placeholder="person@yourchurch.org"
                required
              />
            </label>

            <label className={styles.field}>
              <span>Role</span>
              <select
                name="role"
                value={inviteRole}
                onChange={(event) => setInviteRole(event.target.value)}
              >
                {roleOptions.map((role) => (
                  <option value={role} key={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.field}>
              <span>Workspace scope</span>
              <select
                name="campusId"
                value={inviteCampusId}
                disabled={selectedCampusId !== null}
                onChange={(event) => {
                  const campusId = event.target.value;
                  setInviteCampusId(campusId);
                  if (campusId && inviteRole === "ORG_ADMIN") {
                    setInviteRole("CAMPUS_ADMIN");
                  } else if (!campusId && inviteRole === "CAMPUS_ADMIN") {
                    setInviteRole("CONTENT_LEAD");
                  }
                }}
              >
                {selectedCampusId === null ? (
                  <option value="">Organization-wide</option>
                ) : null}
                {directory.campuses.map((campus) => (
                  <option value={campus.id} key={campus.id}>
                    {campus.name}
                  </option>
                ))}
              </select>
            </label>

            <button
              className={styles.primaryButton}
              type="submit"
              disabled={busyKey !== null}
            >
              {busyKey === "invite" ? "Creating link…" : "Create invitation"}
            </button>
          </form>

          {invitationSecret ? (
            <div className={styles.secretPanel} role="status">
              <div>
                <strong>Copy this link now</strong>
                <p>
                  It expires {shortDate(invitationSecret.expiresAt)} and cannot
                  be recovered from SermonClip after you dismiss it.
                </p>
              </div>
              <input
                className={styles.secretInput}
                value={invitationSecret.acceptUrl}
                readOnly
                aria-label="One-time invitation link"
                onFocus={(event) => event.currentTarget.select()}
              />
              <div className={styles.secretActions}>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={() => void copyInvitationLink()}
                >
                  {copyLabel}
                </button>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => setInvitationSecret(null)}
                >
                  I’ve saved it
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className={styles.card} aria-labelledby="members-heading">
        <div className={styles.cardHeading}>
          <div>
            <p className="kicker">Active access</p>
            <h2 id="members-heading">Members</h2>
          </div>
          <span className={styles.count}>{directory.members.length}</span>
        </div>

        <div className={styles.memberList}>
          {directory.members.map((member) => {
            const canOffboard = canManageMembers
              && member.userId !== actorUserId
              && member.role !== "OWNER";
            const candidates = replacementCandidates.filter(
              (candidate) => candidate.userId !== member.userId,
            );

            return (
              <article className={styles.memberRow} key={member.membershipId}>
                <span className={styles.avatar} aria-hidden="true">
                  {member.displayName.slice(0, 1).toUpperCase()}
                </span>
                <div className={styles.memberIdentity}>
                  <strong>{member.displayName}</strong>
                  <span>{member.email}</span>
                </div>
                <div className={styles.memberMeta}>
                  <span className={styles.rolePill}>
                    {ROLE_LABELS[member.role]}
                  </span>
                  <small>{memberScope(member)}</small>
                </div>
                <span
                  className={`${styles.status} ${
                    member.status === "ACTIVE"
                      ? styles.statusActive
                      : styles.statusPaused
                  }`}
                >
                  {member.status === "ACTIVE" ? "Active" : "Suspended"}
                </span>

                {canOffboard ? (
                  <details className={styles.handover}>
                    <summary>Handover</summary>
                    <form
                      action={(formData) => {
                        void offboardMember(
                          member,
                          String(formData.get("replacementUserId") ?? ""),
                        );
                      }}
                    >
                      <label className={styles.field}>
                        <span>Reassign active work to</span>
                        <select name="replacementUserId" defaultValue="">
                          <option value="">Nobody — cancel open assignments</option>
                          {candidates.map((candidate) => (
                            <option
                              value={candidate.userId}
                              key={candidate.userId}
                            >
                              {candidate.displayName}
                            </option>
                          ))}
                        </select>
                      </label>
                      <p>
                        Their sessions and pending invitations will be revoked.
                      </p>
                      <button
                        type="submit"
                        className={styles.dangerButton}
                        disabled={busyKey !== null}
                      >
                        {busyKey === `member:${member.membershipId}`
                          ? "Removing…"
                          : "Remove member"}
                      </button>
                    </form>
                  </details>
                ) : (
                  <span className={styles.protected}>
                    {member.userId === actorUserId ? "You" : "Protected"}
                  </span>
                )}
              </article>
            );
          })}
        </div>
      </section>

      {canManageInvitations ? (
        <section className={styles.card} aria-labelledby="pending-heading">
          <div className={styles.cardHeading}>
            <div>
              <p className="kicker">Awaiting response</p>
              <h2 id="pending-heading">Pending invitations</h2>
            </div>
            <span className={styles.count}>
              {directory.pendingInvitations.length}
            </span>
          </div>

          {directory.pendingInvitations.length === 0 ? (
            <p className={styles.emptyState}>There are no pending invitations.</p>
          ) : (
            <div className={styles.invitationList}>
              {directory.pendingInvitations.map((invitation) => (
                <article
                  className={styles.invitationRow}
                  key={invitation.invitationId}
                >
                  <div>
                    <strong>{invitation.email}</strong>
                    <span>
                      {ROLE_LABELS[invitation.role]} ·{" "}
                      {invitation.campusName ?? "Organization-wide"}
                    </span>
                  </div>
                  <small>Expires {shortDate(invitation.expiresAt)}</small>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    disabled={busyKey !== null}
                    onClick={() => void revokeInvitation(invitation.invitationId)}
                  >
                    {busyKey === `invitation:${invitation.invitationId}`
                      ? "Revoking…"
                      : "Revoke"}
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
