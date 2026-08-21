import { createHash, randomUUID } from "node:crypto";

import {
  buildDuplicatePublicationGuardInputs,
  type ApprovedPreviewReceipt,
  type ScheduledPublicationPayload,
} from "@/server/publishing/publicationIntegrity";

export type PublishingHandoffRole =
  | "PASTOR_APPROVER"
  | "COMMUNICATIONS_PREPARER"
  | "PUBLISHER";

export type PublishingHandoffAction =
  | "APPROVE_MESSAGE"
  | "PREPARE_POST"
  | "VERIFY_PREFLIGHT"
  | "REQUEST_CONNECTOR_HANDOFF"
  | "RECONCILE"
  | "MANUAL_HANDOFF";

export type GovernedPublishingActor = {
  actorId: string;
  organizationId: string;
  campusId: string | null;
  handoffRole: PublishingHandoffRole;
};

const ROLE_ACTIONS: Record<PublishingHandoffRole, ReadonlySet<PublishingHandoffAction>> = {
  PASTOR_APPROVER: new Set(["APPROVE_MESSAGE"]),
  COMMUNICATIONS_PREPARER: new Set(["PREPARE_POST", "MANUAL_HANDOFF"]),
  PUBLISHER: new Set(["VERIFY_PREFLIGHT", "REQUEST_CONNECTOR_HANDOFF", "RECONCILE", "MANUAL_HANDOFF"]),
};

export type GovernedPublishIntent = {
  schemaVersion: 1;
  intentId: string;
  organizationId: string;
  campusId: string | null;
  scheduledPostId: string;
  connectorId: string;
  connectorIdempotencyKey: string;
  approvedPreviewIdentity: string;
  approvedRevisionId: string;
  approvedByActorRef: string;
  requestedByActorId: string;
  requestedAt: string;
  scheduledFor: string | null;
  audience: string;
  requestedVisibility: "PRIVATE";
  explicitPublishIntent: true;
  autoPublish: false;
};

export type GovernedIntentBlockReason =
  | "EXPLICIT_PUBLISH_INTENT_REQUIRED"
  | "ROLE_NOT_AUTHORIZED"
  | "TENANT_SCOPE_MISMATCH"
  | "CONNECTOR_ID_REQUIRED"
  | "CONNECTOR_IDEMPOTENCY_MISMATCH"
  | "APPROVAL_OR_PAYLOAD_INVALID";

export type GovernedIntentResult =
  | { status: "READY"; intent: GovernedPublishIntent }
  | { status: "BLOCKED"; reasons: GovernedIntentBlockReason[]; details: string[] };

export type ConnectorHandoffResult = {
  status: "STAGED_PRIVATE" | "MANUAL_HANDOFF_REQUIRED";
  connectorReference: string;
  idempotentReplay: boolean;
  summary: string;
};

export type ConnectorReconciliationResult = {
  status: "PRIVATE_CONFIRMED" | "NOT_SENT" | "FAILED" | "UNKNOWN";
  checkedAt: string;
  connectorReference: string;
  detail: string;
  retrySafe: boolean;
};

/**
 * Portable Phase 6 connector boundary. Implementations available in this phase
 * are deliberately unable to send to a third party.
 */
export interface PublishingConnectorAdapter {
  readonly connectorId: string;
  readonly externalSendEnabled: false;
  stagePrivateHandoff(intent: GovernedPublishIntent): Promise<ConnectorHandoffResult>;
  reconcilePrivateHandoff(intent: GovernedPublishIntent): Promise<ConnectorReconciliationResult>;
}

export type PublishingAuditEvent = {
  id: string;
  organizationId: string;
  campusId: string | null;
  scheduledPostId: string;
  intentId: string;
  actorId: string;
  handoffRole: PublishingHandoffRole;
  eventType:
    | "INTENT_BLOCKED"
    | "PRIVATE_HANDOFF_STAGED"
    | "IDEMPOTENT_REPLAY"
    | "RECONCILIATION_RECORDED";
  outcome: string;
  detail: string;
  occurredAt: string;
};

export interface PublishingAuditRepository {
  append(event: PublishingAuditEvent): Promise<void>;
  list(scope: { organizationId: string; campusId: string | null; scheduledPostId?: string }): Promise<PublishingAuditEvent[]>;
}

function normalize(value: string): string {
  return value.normalize("NFKC").trim();
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sameTenant(
  actor: Pick<GovernedPublishingActor, "organizationId" | "campusId">,
  target: { organizationId: string; campusId: string | null },
): boolean {
  return actor.organizationId === target.organizationId && actor.campusId === target.campusId;
}

export function canPerformPublishingHandoffAction(
  role: PublishingHandoffRole,
  action: PublishingHandoffAction,
): boolean {
  return ROLE_ACTIONS[role].has(action);
}

export function buildConnectorIdempotencyKey(input: {
  connectorId: string;
  publicationRetryIdempotencyKey: string;
}): string {
  return sha256({
    purpose: "governed-connector-private-handoff",
    connectorId: normalize(input.connectorId),
    publicationRetryIdempotencyKey: input.publicationRetryIdempotencyKey,
  });
}

export function createGovernedPublishIntent(input: {
  actor: GovernedPublishingActor;
  approvedPreview: ApprovedPreviewReceipt;
  scheduledPayload: ScheduledPublicationPayload;
  connectorId: string;
  explicitPublishIntent: boolean;
  connectorIdempotencyKey?: string;
  intentId?: string;
  requestedAt?: Date;
  scheduledFor?: Date | null;
  audience?: string;
}): GovernedIntentResult {
  const reasons: GovernedIntentBlockReason[] = [];
  const details: string[] = [];
  const connectorId = normalize(input.connectorId);

  if (!input.explicitPublishIntent) {
    reasons.push("EXPLICIT_PUBLISH_INTENT_REQUIRED");
    details.push("A publisher must explicitly confirm this exact post before connector handoff.");
  }
  if (!canPerformPublishingHandoffAction(input.actor.handoffRole, "REQUEST_CONNECTOR_HANDOFF")) {
    reasons.push("ROLE_NOT_AUTHORIZED");
    details.push("This handoff role cannot request a connector operation.");
  }
  if (!sameTenant(input.actor, input.scheduledPayload)) {
    reasons.push("TENANT_SCOPE_MISMATCH");
    details.push("The actor and scheduled post do not belong to the same church and campus scope.");
  }
  if (!connectorId) {
    reasons.push("CONNECTOR_ID_REQUIRED");
    details.push("Choose a connector before preparing the handoff.");
  }

  const publicationGuard = buildDuplicatePublicationGuardInputs({
    approvedPreview: input.approvedPreview,
    scheduledPayload: input.scheduledPayload,
  });
  if (!publicationGuard.ok) {
    reasons.push("APPROVAL_OR_PAYLOAD_INVALID");
    details.push(...publicationGuard.reasons);
  }

  const expectedConnectorKey = publicationGuard.ok && connectorId
    ? buildConnectorIdempotencyKey({
        connectorId,
        publicationRetryIdempotencyKey: publicationGuard.guard.retryIdempotencyKey,
      })
    : "";
  if (
    input.connectorIdempotencyKey !== undefined
    && input.connectorIdempotencyKey !== expectedConnectorKey
  ) {
    reasons.push("CONNECTOR_IDEMPOTENCY_MISMATCH");
    details.push("The connector retry key does not match this approved post and destination.");
  }

  if (reasons.length > 0 || !publicationGuard.ok) {
    return { status: "BLOCKED", reasons: [...new Set(reasons)], details: [...new Set(details)] };
  }

  return {
    status: "READY",
    intent: {
      schemaVersion: 1,
      intentId: normalize(input.intentId ?? randomUUID()),
      organizationId: input.scheduledPayload.organizationId,
      campusId: input.scheduledPayload.campusId,
      scheduledPostId: normalize(input.scheduledPayload.scheduledPostId),
      connectorId,
      connectorIdempotencyKey: expectedConnectorKey,
      approvedPreviewIdentity: publicationGuard.guard.approvedPreviewIdentity,
      approvedRevisionId: normalize(input.scheduledPayload.approvedRevisionId),
      approvedByActorRef: normalize(input.approvedPreview.approvedByActorRef),
      requestedByActorId: normalize(input.actor.actorId),
      requestedAt: (input.requestedAt ?? new Date()).toISOString(),
      scheduledFor: input.scheduledFor?.toISOString() ?? null,
      audience: normalize(input.audience ?? "Confirm the audience in the destination platform"),
      // Phase 6 foundations never request public visibility and never run
      // without a human's explicit intent.
      requestedVisibility: "PRIVATE",
      explicitPublishIntent: true,
      autoPublish: false,
    },
  };
}

function auditEvent(input: {
  intent: GovernedPublishIntent;
  actor: GovernedPublishingActor;
  eventType: PublishingAuditEvent["eventType"];
  outcome: string;
  detail: string;
  occurredAt?: Date;
}): PublishingAuditEvent {
  return {
    id: randomUUID(),
    organizationId: input.intent.organizationId,
    campusId: input.intent.campusId,
    scheduledPostId: input.intent.scheduledPostId,
    intentId: input.intent.intentId,
    actorId: input.actor.actorId,
    handoffRole: input.actor.handoffRole,
    eventType: input.eventType,
    outcome: input.outcome,
    detail: input.detail,
    occurredAt: (input.occurredAt ?? new Date()).toISOString(),
  };
}

export async function stageGovernedPrivateHandoff(input: {
  actor: GovernedPublishingActor;
  intent: GovernedPublishIntent;
  connector: PublishingConnectorAdapter;
  audit: PublishingAuditRepository;
}): Promise<ConnectorHandoffResult> {
  if (
    !sameTenant(input.actor, input.intent)
    || !canPerformPublishingHandoffAction(input.actor.handoffRole, "REQUEST_CONNECTOR_HANDOFF")
  ) {
    throw new Error("The actor is not authorized for this church publishing handoff.");
  }
  if (input.connector.connectorId !== input.intent.connectorId || input.connector.externalSendEnabled !== false) {
    throw new Error("Only the selected no-send connector may stage this private handoff.");
  }

  const result = await input.connector.stagePrivateHandoff(input.intent);
  await input.audit.append(auditEvent({
    intent: input.intent,
    actor: input.actor,
    eventType: result.idempotentReplay ? "IDEMPOTENT_REPLAY" : "PRIVATE_HANDOFF_STAGED",
    outcome: result.status,
    detail: result.summary,
  }));
  return result;
}

export async function reconcileGovernedPrivateHandoff(input: {
  actor: GovernedPublishingActor;
  intent: GovernedPublishIntent;
  connector: PublishingConnectorAdapter;
  audit: PublishingAuditRepository;
}): Promise<ConnectorReconciliationResult> {
  if (
    !sameTenant(input.actor, input.intent)
    || !canPerformPublishingHandoffAction(input.actor.handoffRole, "RECONCILE")
  ) {
    throw new Error("The actor is not authorized to reconcile this church publishing handoff.");
  }

  const result = await input.connector.reconcilePrivateHandoff(input.intent);
  await input.audit.append(auditEvent({
    intent: input.intent,
    actor: input.actor,
    eventType: "RECONCILIATION_RECORDED",
    outcome: result.status,
    detail: result.detail,
  }));
  return result;
}

/** Test/local harness only. Production callers should use a durable repository. */
export class InMemoryPublishingAuditRepository implements PublishingAuditRepository {
  readonly #events: PublishingAuditEvent[] = [];

  async append(event: PublishingAuditEvent): Promise<void> {
    this.#events.push(structuredClone(event));
  }

  async list(scope: {
    organizationId: string;
    campusId: string | null;
    scheduledPostId?: string;
  }): Promise<PublishingAuditEvent[]> {
    return this.#events
      .filter((event) => (
        event.organizationId === scope.organizationId
        && event.campusId === scope.campusId
        && (!scope.scheduledPostId || event.scheduledPostId === scope.scheduledPostId)
      ))
      .map((event) => structuredClone(event));
  }
}

export class NoopPublishingConnector implements PublishingConnectorAdapter {
  readonly externalSendEnabled = false as const;
  readonly #handoffs = new Map<string, ConnectorHandoffResult>();
  readonly #reconciliations = new Map<string, ConnectorReconciliationResult>();

  constructor(readonly connectorId = "noop-local") {}

  async stagePrivateHandoff(intent: GovernedPublishIntent): Promise<ConnectorHandoffResult> {
    const existing = this.#handoffs.get(intent.connectorIdempotencyKey);
    if (existing) return { ...existing, idempotentReplay: true };

    const result: ConnectorHandoffResult = {
      status: "MANUAL_HANDOFF_REQUIRED",
      connectorReference: `noop:${intent.connectorIdempotencyKey.slice(0, 16)}`,
      idempotentReplay: false,
      summary: "No external send occurred. Use the private/manual publishing handoff.",
    };
    this.#handoffs.set(intent.connectorIdempotencyKey, result);
    return result;
  }

  async reconcilePrivateHandoff(intent: GovernedPublishIntent): Promise<ConnectorReconciliationResult> {
    return this.#reconciliations.get(intent.connectorIdempotencyKey) ?? {
      status: "NOT_SENT",
      checkedAt: new Date().toISOString(),
      connectorReference: `noop:${intent.connectorIdempotencyKey.slice(0, 16)}`,
      detail: "The no-op connector did not contact a provider. Manual platform verification is still required.",
      retrySafe: true,
    };
  }

  setReconciliationResult(
    connectorIdempotencyKey: string,
    result: ConnectorReconciliationResult,
  ): void {
    this.#reconciliations.set(connectorIdempotencyKey, structuredClone(result));
  }
}
