import type { Metadata } from "next";
import Link from "next/link";

import {
  EmptyState,
  Notice,
  PageHeader,
  SectionCard,
  StatCard,
  StatusBadge,
} from "@/components/ui";
import { prisma } from "@/lib/prisma";
import {
  requirePersistedTenantCapability,
  requireRequestCapability,
} from "@/server/auth/requestAuthorization";
import {
  loadWorkInbox,
  prismaWorkInboxRepository,
  type WorkInboxAssignment,
} from "@/server/collaboration/inboxService";
import {
  addInboxCommentFormAction,
  approveInboxApprovalFormAction,
  completeInboxAssignmentFormAction,
  requestInboxChangesFormAction,
} from "@/app/inbox/actions";

import "./inbox.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "My work inbox",
  description: "Assignments, pastor approvals, and team conversations that need attention today.",
};

type InboxSearchParams = Readonly<{
  notice?: string;
  error?: string;
}>;

function safeTimeZone(value: string): string {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return value;
  } catch {
    return "UTC";
  }
}

function formatDate(value: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function formatRelativeDate(
  assignment: WorkInboxAssignment,
  timeZone: string,
): string {
  if (!assignment.dueAt) return "No due date";
  const time = new Intl.DateTimeFormat("en", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(assignment.dueAt);
  if (assignment.timing === "OVERDUE") {
    return `Overdue · ${formatDate(assignment.dueAt, timeZone)}`;
  }
  if (assignment.timing === "TODAY") return `Today · ${time}`;
  return formatDate(assignment.dueAt, timeZone);
}

function dueTone(
  timing: WorkInboxAssignment["timing"],
): "danger" | "warning" | "info" | "neutral" {
  if (timing === "OVERDUE") return "danger";
  if (timing === "TODAY") return "warning";
  if (timing === "UPCOMING") return "info";
  return "neutral";
}

function contentFormat(value: string | null): string {
  if (!value) return "Whole Week Draft";
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function policyMode(value: string): string {
  if (value === "ALL_REQUIRED_ROLES") return "Every required role";
  if (value === "QUORUM") return "Approval quorum";
  return "Any eligible approver";
}

function weekDraftHref(weekDraftId: string, itemId?: string | null): string {
  const params = itemId ? `?item=${encodeURIComponent(itemId)}` : "";
  return `/week-drafts/${encodeURIComponent(weekDraftId)}${params}`;
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<InboxSearchParams>;
}) {
  const requestContext = await requireRequestCapability("assignments.read");
  await requirePersistedTenantCapability(
    requestContext,
    "approvals.read",
  );
  await requirePersistedTenantCapability(
    requestContext,
    "comments.read",
  );

  const [filters, organization] = await Promise.all([
    searchParams,
    prisma.organization.findUnique({
      where: { id: requestContext.organizationId },
      select: { name: true, timezone: true },
    }),
  ]);
  const timeZone = safeTimeZone(organization?.timezone ?? "UTC");
  const inbox = await loadWorkInbox(prismaWorkInboxRepository, {
    tenant: {
      organizationId: requestContext.organizationId,
      campusId: requestContext.campusId,
    },
    actorId: requestContext.actorId,
    timeZone,
  });
  const totalNeedsAttention =
    inbox.counts.assignments + inbox.counts.approvals;

  return (
    <main className="page-shell inbox-page stack-lg">
      <PageHeader
        eyebrow={organization?.name ?? "Church workspace"}
        title="What needs me today?"
        description="One calm place for your assignments, pastor approvals, and the conversations where your team asked for you."
        actions={[
          {
            label: "Open Week Drafts",
            href: "/week-drafts",
            variant: "secondary",
          },
        ]}
        meta={(
          <StatusBadge tone={totalNeedsAttention > 0 ? "warning" : "success"}>
            {totalNeedsAttention > 0
              ? `${totalNeedsAttention} need attention`
              : "You are caught up"}
          </StatusBadge>
        )}
      />

      {filters.notice ? (
        <Notice tone="success" title="Saved" live>
          <p>{filters.notice}</p>
        </Notice>
      ) : null}
      {filters.error ? (
        <Notice tone="danger" title="Could not save" live>
          <p>{filters.error}</p>
        </Notice>
      ) : null}

      <section className="inbox-signal-grid" aria-label="Work inbox summary">
        <StatCard
          label="Waiting for your approval"
          value={inbox.counts.approvals}
          detail="Current revisions you are eligible to decide"
          tone={inbox.counts.approvals > 0 ? "accent" : "success"}
        />
        <StatCard
          label="Your active assignments"
          value={inbox.counts.assignments}
          detail={`${inbox.counts.dueToday} due today`}
          tone={inbox.counts.dueToday > 0 ? "warning" : "neutral"}
        />
        <StatCard
          label="Overdue"
          value={inbox.counts.overdue}
          detail="Move these first or ask the team to reset the date"
          tone={inbox.counts.overdue > 0 ? "danger" : "success"}
        />
        <StatCard
          label="Recent mentions"
          value={inbox.counts.mentions}
          detail="Latest places teammates called you into the conversation"
          tone="neutral"
        />
      </section>

      <SectionCard
        title="Pastor approval"
        description="Approve the exact revision in front of you, or give the content team a clear change request."
        className="inbox-approval-section"
      >
        {inbox.approvals.length === 0 ? (
          <EmptyState
            eyebrow="Approval queue clear"
            title="Nothing is waiting on you"
            description="When the content team sends a Week Draft item under a policy you can approve, it will appear here."
            action={{
              label: "Review Week Drafts",
              href: "/week-drafts",
              variant: "secondary",
            }}
          />
        ) : (
          <div className="inbox-work-list">
            {inbox.approvals.map((approval) => (
              <article className="inbox-work-card inbox-approval-card" key={approval.id}>
                <div className="inbox-work-card-main stack-sm">
                  <div className="inbox-card-labels">
                    <StatusBadge tone="accent">Approval needed</StatusBadge>
                    <span className="muted small">{contentFormat(approval.format)}</span>
                  </div>
                  <div>
                    <h3>{approval.title}</h3>
                    <p className="muted small">
                      {approval.draftTitle} · requested by {approval.requestedBy}
                    </p>
                  </div>
                  {approval.message ? (
                    <blockquote className="inbox-request-message">
                      {approval.message}
                    </blockquote>
                  ) : null}
                  <div className="inbox-policy-row" aria-label="Approval policy">
                    <strong>{approval.policyName}</strong>
                    <span>
                      {policyMode(approval.policyMode)} · {approval.approvalsReceived}
                      /{approval.minimumApprovals} approvals
                    </span>
                  </div>
                </div>

                <div className="inbox-approval-actions">
                  <Link
                    className="button secondary"
                    href={weekDraftHref(
                      approval.weekDraftId,
                      approval.weekDraftItemId,
                    )}
                  >
                    Open &amp; review
                  </Link>
                  <form action={approveInboxApprovalFormAction}>
                    <input
                      type="hidden"
                      name="approvalRequestId"
                      value={approval.id}
                    />
                    <input
                      type="hidden"
                      name="decidedAsRole"
                      value={approval.eligibleRole}
                    />
                    <button className="button primary" type="submit">
                      Approve this version
                    </button>
                  </form>
                  <details className="inbox-change-request">
                    <summary>Request a change</summary>
                    <form
                      action={requestInboxChangesFormAction}
                      className="stack-sm"
                    >
                      <input
                        type="hidden"
                        name="approvalRequestId"
                        value={approval.id}
                      />
                      <input
                        type="hidden"
                        name="decidedAsRole"
                        value={approval.eligibleRole}
                      />
                      <label htmlFor={`reason-${approval.id}`}>
                        What should the team change?
                      </label>
                      <textarea
                        id={`reason-${approval.id}`}
                        name="reason"
                        rows={3}
                        maxLength={5_000}
                        placeholder="Be specific enough that the editor can act without another meeting."
                        required
                      />
                      <button className="button danger" type="submit">
                        Send change request
                      </button>
                    </form>
                  </details>
                  <details className="inbox-comment-composer">
                    <summary>Leave a comment</summary>
                    <form action={addInboxCommentFormAction} className="stack-sm">
                      <input
                        type="hidden"
                        name="weekDraftId"
                        value={approval.weekDraftId}
                      />
                      <input
                        type="hidden"
                        name="weekDraftItemId"
                        value={approval.weekDraftItemId}
                      />
                      <label htmlFor={`comment-${approval.id}`}>
                        Add context without deciding yet
                      </label>
                      <textarea
                        id={`comment-${approval.id}`}
                        name="body"
                        rows={3}
                        maxLength={5_000}
                        required
                      />
                      <button className="button secondary" type="submit">
                        Add comment
                      </button>
                    </form>
                  </details>
                </div>
              </article>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="My assignments"
        description="Work specifically assigned to you, sorted by urgency."
      >
        {inbox.assignments.length === 0 ? (
          <EmptyState
            eyebrow="Assignment queue clear"
            title="No active assignments"
            description="You can still open a Week Draft to review the whole content week."
            action={{
              label: "Open Week Drafts",
              href: "/week-drafts",
              variant: "secondary",
            }}
          />
        ) : (
          <div className="inbox-work-list">
            {inbox.assignments.map((assignment) => (
              <article className="inbox-work-card" key={assignment.id}>
                <div className="inbox-work-card-main stack-sm">
                  <div className="inbox-card-labels">
                    <StatusBadge tone={dueTone(assignment.timing)}>
                      {formatRelativeDate(assignment, timeZone)}
                    </StatusBadge>
                    <span className="muted small">
                      {contentFormat(assignment.format)}
                    </span>
                  </div>
                  <div>
                    <h3>{assignment.title}</h3>
                    <p className="muted small">
                      {assignment.draftTitle}
                      {assignment.assignedBy
                        ? ` · assigned by ${assignment.assignedBy}`
                        : ""}
                    </p>
                  </div>
                </div>
                <div className="inbox-assignment-actions">
                  <Link
                    className="button secondary"
                    href={weekDraftHref(
                      assignment.weekDraftId,
                      assignment.weekDraftItemId,
                    )}
                  >
                    Open work
                  </Link>
                  <form action={completeInboxAssignmentFormAction}>
                    <input
                      type="hidden"
                      name="assignmentId"
                      value={assignment.id}
                    />
                    <button className="button tertiary" type="submit">
                      Mark complete
                    </button>
                  </form>
                </div>
              </article>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Recent mentions"
        description="The latest Week Draft conversations where a teammate mentioned you. Read/unread tracking is not inferred, so this list is intentionally labelled recent."
      >
        {inbox.mentions.length === 0 ? (
          <EmptyState
            title="No recent mentions"
            description="Mentions will appear here with the content and teammate context you need to respond."
          />
        ) : (
          <ol className="inbox-mention-list">
            {inbox.mentions.map((mention) => (
              <li key={`${mention.commentId}-${mention.createdAt.toISOString()}`}>
                <div className="inbox-mention-heading">
                  <div>
                    <strong>{mention.title}</strong>
                    <p className="muted small">
                      {mention.author} · {formatDate(mention.createdAt, timeZone)}
                    </p>
                  </div>
                  <Link
                    className="button tertiary"
                    href={weekDraftHref(
                      mention.weekDraftId,
                      mention.weekDraftItemId,
                    )}
                  >
                    Open conversation
                  </Link>
                </div>
                <p className="inbox-mention-body">{mention.body}</p>
              </li>
            ))}
          </ol>
        )}
      </SectionCard>
    </main>
  );
}
