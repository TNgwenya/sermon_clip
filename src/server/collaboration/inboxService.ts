import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import type { OrganizationRole } from "@/server/auth/authorization";
import type { WeekDraftTenantContext } from "@/server/weekDraft/domain";

export type WorkInboxAssignment = Readonly<{
  id: string;
  weekDraftId: string;
  weekDraftItemId: string | null;
  title: string;
  draftTitle: string;
  format: string | null;
  status: string;
  dueAt: Date | null;
  assignedBy: string | null;
  createdAt: Date;
  timing: "OVERDUE" | "TODAY" | "UPCOMING" | "NO_DUE_DATE";
}>;

export type WorkInboxApproval = Readonly<{
  id: string;
  weekDraftId: string;
  weekDraftItemId: string;
  title: string;
  draftTitle: string;
  format: string;
  requestedBy: string;
  requestedAt: Date;
  message: string | null;
  policyName: string;
  policyMode: string;
  minimumApprovals: number;
  approvalsReceived: number;
  eligibleRole: OrganizationRole;
}>;

export type WorkInboxMention = Readonly<{
  commentId: string;
  weekDraftId: string;
  weekDraftItemId: string | null;
  title: string;
  draftTitle: string;
  body: string;
  author: string;
  createdAt: Date;
}>;

export type WorkInbox = Readonly<{
  assignments: readonly WorkInboxAssignment[];
  approvals: readonly WorkInboxApproval[];
  mentions: readonly WorkInboxMention[];
  counts: Readonly<{
    overdue: number;
    dueToday: number;
    assignments: number;
    approvals: number;
    mentions: number;
  }>;
}>;

type InboxUser = Readonly<{
  email: string;
  profile: { displayName: string } | null;
}>;

type RawAssignment = Readonly<{
  id: string;
  weekDraftId: string;
  weekDraftItemId: string | null;
  dueAt: Date | null;
  createdAt: Date;
  assignedBy: InboxUser | null;
  weekDraft: {
    title: string;
    status: string;
  };
  weekDraftItem: {
    title: string;
    format: string;
    status: string;
  } | null;
}>;

type RawApproval = Readonly<{
  id: string;
  weekDraftId: string;
  weekDraftItemId: string;
  revisionId: string;
  requestedByUserId: string;
  policySnapshotJson: Prisma.JsonValue;
  message: string | null;
  createdAt: Date;
  requestedBy: InboxUser;
  weekDraft: { title: string };
  weekDraftItem: {
    title: string;
    format: string;
    currentRevisionId: string | null;
  };
  decisions: ReadonlyArray<{
    decidedByUserId: string;
    decision: string;
  }>;
}>;

type RawMention = Readonly<{
  commentId: string;
  createdAt: Date;
  comment: {
    weekDraftId: string;
    weekDraftItemId: string | null;
    body: string;
    createdAt: Date;
    author: InboxUser;
    weekDraft: { title: string };
    weekDraftItem: { title: string } | null;
  };
}>;

type RawMembership = Readonly<{
  role: string;
  campusId: string | null;
}>;

export type WorkInboxRepository = Readonly<{
  listMemberships(input: Readonly<{
    tenant: WeekDraftTenantContext;
    actorId: string;
    now: Date;
  }>): Promise<readonly RawMembership[]>;
  listAssignments(input: Readonly<{
    tenant: WeekDraftTenantContext;
    actorId: string;
  }>): Promise<readonly RawAssignment[]>;
  listApprovals(input: Readonly<{
    tenant: WeekDraftTenantContext;
    actorId: string;
  }>): Promise<readonly RawApproval[]>;
  listMentions(input: Readonly<{
    tenant: WeekDraftTenantContext;
    actorId: string;
  }>): Promise<readonly RawMention[]>;
}>;

type ParsedApprovalPolicy = Readonly<{
  policyName: string;
  mode: string;
  minimumApprovals: number;
  allowSelfApproval: boolean;
  roles: readonly string[];
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseApprovalPolicy(value: Prisma.JsonValue): ParsedApprovalPolicy | null {
  if (!isRecord(value) || !Array.isArray(value.rules)) {
    return null;
  }

  const roles = value.rules.flatMap((rule) => (
    isRecord(rule) && typeof rule.role === "string" ? [rule.role] : []
  ));
  if (
    typeof value.policyName !== "string"
    || typeof value.mode !== "string"
    || typeof value.minimumApprovals !== "number"
    || !Number.isSafeInteger(value.minimumApprovals)
    || value.minimumApprovals < 1
    || typeof value.allowSelfApproval !== "boolean"
    || roles.length === 0
  ) {
    return null;
  }

  return {
    policyName: value.policyName,
    mode: value.mode,
    minimumApprovals: value.minimumApprovals,
    allowSelfApproval: value.allowSelfApproval,
    roles,
  };
}

function userLabel(user: InboxUser): string {
  return user.profile?.displayName.trim() || user.email;
}

function calendarDateKey(value: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function classifyInboxDueDate(
  dueAt: Date | null,
  now: Date,
  timeZone = "UTC",
): WorkInboxAssignment["timing"] {
  if (!dueAt) return "NO_DUE_DATE";
  const dueDate = calendarDateKey(dueAt, timeZone);
  const today = calendarDateKey(now, timeZone);
  if (dueDate < today) return "OVERDUE";
  if (dueDate === today) return "TODAY";
  return "UPCOMING";
}

const ROLE_SET: ReadonlySet<string> = new Set([
  "OWNER",
  "ORG_ADMIN",
  "CAMPUS_ADMIN",
  "PASTOR_APPROVER",
  "CONTENT_LEAD",
  "EDITOR",
  "PUBLISHER",
  "ANALYST",
  "VIEWER",
  "EXTERNAL_CONTRACTOR",
]);

function isOrganizationRole(value: string): value is OrganizationRole {
  return ROLE_SET.has(value);
}

function resolveMembershipRoles(
  memberships: readonly RawMembership[],
  campusId: string | null | undefined,
): readonly OrganizationRole[] {
  const exactCampus = memberships.filter(
    (membership) => campusId && membership.campusId === campusId,
  );
  const organizationWide = memberships.filter(
    (membership) => membership.campusId === null,
  );
  return [...exactCampus, ...organizationWide]
    .map((membership) => membership.role)
    .filter(isOrganizationRole);
}

function compareAssignments(
  left: WorkInboxAssignment,
  right: WorkInboxAssignment,
): number {
  const priority = {
    OVERDUE: 0,
    TODAY: 1,
    UPCOMING: 2,
    NO_DUE_DATE: 3,
  } as const;
  const priorityDifference = priority[left.timing] - priority[right.timing];
  if (priorityDifference !== 0) return priorityDifference;
  if (left.dueAt && right.dueAt) {
    const dueDifference = left.dueAt.getTime() - right.dueAt.getTime();
    if (dueDifference !== 0) return dueDifference;
  }
  return left.createdAt.getTime() - right.createdAt.getTime();
}

export async function loadWorkInbox(
  repository: WorkInboxRepository,
  input: Readonly<{
    tenant: WeekDraftTenantContext;
    actorId: string;
    now?: Date;
    timeZone?: string;
  }>,
): Promise<WorkInbox> {
  const now = input.now ?? new Date();
  const timeZone = input.timeZone ?? "UTC";
  const [memberships, rawAssignments, rawApprovals, rawMentions] =
    await Promise.all([
      repository.listMemberships({
        tenant: input.tenant,
        actorId: input.actorId,
        now,
      }),
      repository.listAssignments(input),
      repository.listApprovals(input),
      repository.listMentions(input),
    ]);
  const roles = resolveMembershipRoles(memberships, input.tenant.campusId);

  const assignments = rawAssignments.map((assignment): WorkInboxAssignment => ({
    id: assignment.id,
    weekDraftId: assignment.weekDraftId,
    weekDraftItemId: assignment.weekDraftItemId,
    title: assignment.weekDraftItem?.title ?? assignment.weekDraft.title,
    draftTitle: assignment.weekDraft.title,
    format: assignment.weekDraftItem?.format ?? null,
    status: assignment.weekDraftItem?.status ?? assignment.weekDraft.status,
    dueAt: assignment.dueAt,
    assignedBy: assignment.assignedBy
      ? userLabel(assignment.assignedBy)
      : null,
    createdAt: assignment.createdAt,
    timing: classifyInboxDueDate(assignment.dueAt, now, timeZone),
  })).sort(compareAssignments);

  const approvals = rawApprovals.flatMap((request): WorkInboxApproval[] => {
    const policy = parseApprovalPolicy(request.policySnapshotJson);
    if (
      !policy
      || request.weekDraftItem.currentRevisionId !== request.revisionId
      || request.decisions.some(
        (decision) => decision.decidedByUserId === input.actorId,
      )
      || (!policy.allowSelfApproval
        && request.requestedByUserId === input.actorId)
    ) {
      return [];
    }
    const eligibleRole = roles.find((role) => policy.roles.includes(role));
    if (!eligibleRole) return [];

    return [{
      id: request.id,
      weekDraftId: request.weekDraftId,
      weekDraftItemId: request.weekDraftItemId,
      title: request.weekDraftItem.title,
      draftTitle: request.weekDraft.title,
      format: request.weekDraftItem.format,
      requestedBy: userLabel(request.requestedBy),
      requestedAt: request.createdAt,
      message: request.message,
      policyName: policy.policyName,
      policyMode: policy.mode,
      minimumApprovals: policy.minimumApprovals,
      approvalsReceived: request.decisions.filter(
        (decision) => decision.decision === "APPROVE",
      ).length,
      eligibleRole,
    }];
  });

  const mentions = rawMentions.map((mention): WorkInboxMention => ({
    commentId: mention.commentId,
    weekDraftId: mention.comment.weekDraftId,
    weekDraftItemId: mention.comment.weekDraftItemId,
    title: mention.comment.weekDraftItem?.title ?? mention.comment.weekDraft.title,
    draftTitle: mention.comment.weekDraft.title,
    body: mention.comment.body,
    author: userLabel(mention.comment.author),
    createdAt: mention.comment.createdAt,
  }));

  return {
    assignments,
    approvals,
    mentions,
    counts: {
      overdue: assignments.filter(
        (assignment) => assignment.timing === "OVERDUE",
      ).length,
      dueToday: assignments.filter(
        (assignment) => assignment.timing === "TODAY",
      ).length,
      assignments: assignments.length,
      approvals: approvals.length,
      mentions: mentions.length,
    },
  };
}

function tenantWhere(tenant: WeekDraftTenantContext) {
  return {
    organizationId: tenant.organizationId,
    ...(tenant.campusId ? { campusId: tenant.campusId } : {}),
  };
}

export const prismaWorkInboxRepository: WorkInboxRepository = {
  listMemberships({ tenant, actorId, now }) {
    return prisma.membership.findMany({
      where: {
        organizationId: tenant.organizationId,
        userId: actorId,
        status: "ACTIVE",
        ...(tenant.campusId
          ? { OR: [{ campusId: null }, { campusId: tenant.campusId }] }
          : { campusId: null }),
        AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
        user: { status: "ACTIVE" },
      },
      select: { role: true, campusId: true },
    });
  },
  listAssignments({ tenant, actorId }) {
    return prisma.collaborationAssignment.findMany({
      where: {
        ...tenantWhere(tenant),
        assigneeUserId: actorId,
        status: "ACTIVE",
      },
      select: {
        id: true,
        weekDraftId: true,
        weekDraftItemId: true,
        dueAt: true,
        createdAt: true,
        assignedBy: {
          select: {
            email: true,
            profile: { select: { displayName: true } },
          },
        },
        weekDraft: {
          select: { title: true, status: true },
        },
        weekDraftItem: {
          select: { title: true, format: true, status: true },
        },
      },
      take: 100,
    });
  },
  listApprovals({ tenant, actorId }) {
    return prisma.approvalRequest.findMany({
      where: {
        ...tenantWhere(tenant),
        status: "PENDING",
        decisions: { none: { decidedByUserId: actorId } },
      },
      select: {
        id: true,
        weekDraftId: true,
        weekDraftItemId: true,
        revisionId: true,
        requestedByUserId: true,
        policySnapshotJson: true,
        message: true,
        createdAt: true,
        requestedBy: {
          select: {
            email: true,
            profile: { select: { displayName: true } },
          },
        },
        weekDraft: { select: { title: true } },
        weekDraftItem: {
          select: {
            title: true,
            format: true,
            currentRevisionId: true,
          },
        },
        decisions: {
          select: {
            decidedByUserId: true,
            decision: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
  },
  listMentions({ tenant, actorId }) {
    return prisma.collaborationCommentMention.findMany({
      where: {
        ...tenantWhere(tenant),
        mentionedUserId: actorId,
        comment: { deletedAt: null },
      },
      select: {
        commentId: true,
        createdAt: true,
        comment: {
          select: {
            weekDraftId: true,
            weekDraftItemId: true,
            body: true,
            createdAt: true,
            author: {
              select: {
                email: true,
                profile: { select: { displayName: true } },
              },
            },
            weekDraft: { select: { title: true } },
            weekDraftItem: { select: { title: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
  },
};
