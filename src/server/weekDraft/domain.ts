export const WEEK_DRAFT_ITEM_FORMATS = [
  "SHORT_FORM_VIDEO",
  "QUOTE_GRAPHIC",
  "SCRIPTURE_GRAPHIC",
  "CAROUSEL",
  "TEXT_POST",
  "DEVOTIONAL",
  "PRAYER",
  "SERMON_RECAP",
  "STORY",
  "GUIDE",
  "EMAIL",
  "NEWSLETTER",
  "BLOG",
  "OTHER",
] as const;

export type WeekDraftItemFormatValue = (typeof WEEK_DRAFT_ITEM_FORMATS)[number];

export type WeekDraftTenantContext = Readonly<{
  organizationId: string;
  campusId?: string | null;
}>;

export type WeekDraftStatusValue =
  | "DRAFT"
  | "READY_FOR_REVIEW"
  | "IN_REVIEW"
  | "CHANGES_REQUESTED"
  | "APPROVED"
  | "SCHEDULED"
  | "PUBLISHED"
  | "ARCHIVED";

export type WeekDraftItemStatusValue =
  | "DRAFT"
  | "READY_FOR_REVIEW"
  | "IN_REVIEW"
  | "CHANGES_REQUESTED"
  | "APPROVED"
  | "SCHEDULED"
  | "PUBLISHED"
  | "SKIPPED"
  | "ARCHIVED";

export type WeekDraftProvenanceValue =
  | "CLIP_CANDIDATE"
  | "CONTENT_OPPORTUNITY"
  | "CONTENT_ASSET"
  | "MANUAL"
  | "AI_GENERATED";

export type ApprovalPolicySnapshot = Readonly<{
  policyId: string;
  policyName: string;
  mode: "ANY_APPROVER" | "ALL_REQUIRED_ROLES" | "QUORUM";
  minimumApprovals: number;
  allowSelfApproval: boolean;
  rules: readonly Readonly<{
    role: string;
    minimumApprovals: number;
  }>[];
}>;

export type ApprovalDecisionSnapshot = Readonly<{
  userId: string;
  role: string;
  decision: "APPROVE" | "REQUEST_CHANGES";
}>;

export type ApprovalEvaluation =
  | Readonly<{ status: "PENDING"; approvals: number }>
  | Readonly<{ status: "APPROVED"; approvals: number }>
  | Readonly<{ status: "CHANGES_REQUESTED"; approvals: number }>;

export class WeekDraftDomainError extends Error {
  constructor(
    readonly code:
      | "INVALID_STATUS_TRANSITION"
      | "INVALID_ORDER"
      | "INVALID_PROVENANCE"
      | "TENANT_MISMATCH"
      | "STALE_REVISION"
      | "INVALID_APPROVAL_POLICY",
    message: string,
  ) {
    super(message);
    this.name = "WeekDraftDomainError";
  }
}

const DRAFT_TRANSITIONS: Readonly<
  Record<WeekDraftStatusValue, readonly WeekDraftStatusValue[]>
> = {
  DRAFT: ["READY_FOR_REVIEW", "ARCHIVED"],
  READY_FOR_REVIEW: ["DRAFT", "IN_REVIEW", "ARCHIVED"],
  IN_REVIEW: ["DRAFT", "CHANGES_REQUESTED", "APPROVED", "ARCHIVED"],
  CHANGES_REQUESTED: ["DRAFT", "READY_FOR_REVIEW", "IN_REVIEW", "ARCHIVED"],
  APPROVED: ["CHANGES_REQUESTED", "SCHEDULED", "ARCHIVED"],
  SCHEDULED: ["APPROVED", "PUBLISHED", "ARCHIVED"],
  PUBLISHED: ["ARCHIVED"],
  ARCHIVED: [],
};

const ITEM_TRANSITIONS: Readonly<
  Record<WeekDraftItemStatusValue, readonly WeekDraftItemStatusValue[]>
> = {
  DRAFT: ["READY_FOR_REVIEW", "SKIPPED", "ARCHIVED"],
  READY_FOR_REVIEW: ["DRAFT", "IN_REVIEW", "SKIPPED", "ARCHIVED"],
  IN_REVIEW: ["DRAFT", "CHANGES_REQUESTED", "APPROVED", "SKIPPED", "ARCHIVED"],
  CHANGES_REQUESTED: ["DRAFT", "READY_FOR_REVIEW", "IN_REVIEW", "SKIPPED", "ARCHIVED"],
  APPROVED: ["CHANGES_REQUESTED", "SCHEDULED", "SKIPPED", "ARCHIVED"],
  SCHEDULED: ["APPROVED", "PUBLISHED", "ARCHIVED"],
  PUBLISHED: ["ARCHIVED"],
  SKIPPED: ["DRAFT", "ARCHIVED"],
  ARCHIVED: [],
};

export function assertWeekDraftStatusTransition(
  from: WeekDraftStatusValue,
  to: WeekDraftStatusValue,
): void {
  if (from === to) {
    return;
  }
  if (!DRAFT_TRANSITIONS[from].includes(to)) {
    throw new WeekDraftDomainError(
      "INVALID_STATUS_TRANSITION",
      `A Week Draft cannot move from ${from} to ${to}.`,
    );
  }
}

export function assertWeekDraftItemStatusTransition(
  from: WeekDraftItemStatusValue,
  to: WeekDraftItemStatusValue,
): void {
  if (from === to) {
    return;
  }
  if (!ITEM_TRANSITIONS[from].includes(to)) {
    throw new WeekDraftDomainError(
      "INVALID_STATUS_TRANSITION",
      `A Week Draft item cannot move from ${from} to ${to}.`,
    );
  }
}

export function weekDraftTenantWhere(
  tenant: WeekDraftTenantContext,
): Readonly<{ organizationId: string; campusId?: string }> {
  return {
    organizationId: tenant.organizationId,
    ...(tenant.campusId ? { campusId: tenant.campusId } : {}),
  };
}

export function assertWeekDraftTenant<
  RecordValue extends Readonly<{ organizationId: string; campusId?: string | null }>,
>(tenant: WeekDraftTenantContext, record: RecordValue): RecordValue {
  if (
    record.organizationId !== tenant.organizationId
    || (tenant.campusId && record.campusId !== tenant.campusId)
  ) {
    throw new WeekDraftDomainError(
      "TENANT_MISMATCH",
      "The Week Draft resource does not belong to the active tenant.",
    );
  }
  return record;
}

export function assertWeekDraftProvenance(input: Readonly<{
  sourceType: WeekDraftProvenanceValue;
  sourceId?: string | null;
}>): void {
  const needsSource = input.sourceType !== "MANUAL";
  if (needsSource && !input.sourceId?.trim()) {
    throw new WeekDraftDomainError(
      "INVALID_PROVENANCE",
      `${input.sourceType} Week Draft items require a source identity.`,
    );
  }
  if (!needsSource && input.sourceId?.trim()) {
    throw new WeekDraftDomainError(
      "INVALID_PROVENANCE",
      "Manual Week Draft items cannot claim an automated source identity.",
    );
  }
}

export function normalizeWeekDraftItemOrder(
  itemIds: readonly string[],
  spacing = 1_024,
): ReadonlyMap<string, number> {
  if (spacing < 1 || !Number.isSafeInteger(spacing)) {
    throw new WeekDraftDomainError(
      "INVALID_ORDER",
      "Week Draft order spacing must be a positive safe integer.",
    );
  }

  const normalizedIds = itemIds.map((id) => id.trim());
  if (
    normalizedIds.some((id) => !id)
    || new Set(normalizedIds).size !== normalizedIds.length
  ) {
    throw new WeekDraftDomainError(
      "INVALID_ORDER",
      "Week Draft ordering requires unique, non-empty item identities.",
    );
  }

  return new Map(normalizedIds.map((id, index) => [id, (index + 1) * spacing]));
}

export function assertCurrentApprovalRevision(
  currentRevisionId: string | null,
  approvalRevisionId: string,
): void {
  if (!currentRevisionId || currentRevisionId !== approvalRevisionId) {
    throw new WeekDraftDomainError(
      "STALE_REVISION",
      "This approval belongs to an older item revision and cannot approve the current content.",
    );
  }
}

export function evaluateApproval(
  policy: ApprovalPolicySnapshot,
  decisions: readonly ApprovalDecisionSnapshot[],
): ApprovalEvaluation {
  if (
    policy.minimumApprovals < 1
    || !Number.isSafeInteger(policy.minimumApprovals)
    || policy.rules.length === 0
    || policy.rules.some(
      (rule) => rule.minimumApprovals < 1 || !Number.isSafeInteger(rule.minimumApprovals),
    )
  ) {
    throw new WeekDraftDomainError(
      "INVALID_APPROVAL_POLICY",
      "Approval policies need at least one eligible role and positive approval thresholds.",
    );
  }

  const distinctDecisions = new Map(
    decisions.map((decision) => [decision.userId, decision]),
  );
  const uniqueDecisions = [...distinctDecisions.values()];
  const approvals = uniqueDecisions.filter(
    (decision) => decision.decision === "APPROVE",
  );

  if (uniqueDecisions.some((decision) => decision.decision === "REQUEST_CHANGES")) {
    return { status: "CHANGES_REQUESTED", approvals: approvals.length };
  }

  const eligibleRoles = new Set(policy.rules.map((rule) => rule.role));
  const eligibleApprovals = approvals.filter((decision) =>
    eligibleRoles.has(decision.role),
  );

  const approved =
    policy.mode === "ALL_REQUIRED_ROLES"
      ? policy.rules.every(
        (rule) =>
          eligibleApprovals.filter((decision) => decision.role === rule.role).length
            >= rule.minimumApprovals,
      ) && eligibleApprovals.length >= policy.minimumApprovals
      : eligibleApprovals.length >= policy.minimumApprovals;

  return {
    status: approved ? "APPROVED" : "PENDING",
    approvals: eligibleApprovals.length,
  };
}
