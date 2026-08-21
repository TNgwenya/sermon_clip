import { describe, expect, it } from "vitest";

import {
  createGovernedPublishIntent,
  InMemoryPublishingAuditRepository,
  NoopPublishingConnector,
  reconcileGovernedPrivateHandoff,
  stageGovernedPrivateHandoff,
  type GovernedPublishingActor,
} from "@/server/publishing/governedConnector";
import {
  sealApprovedPreview,
  type ApprovedPublicationContent,
  type ApprovedPreviewReceipt,
  type ScheduledPublicationPayload,
} from "@/server/publishing/publicationIntegrity";

const publisher: GovernedPublishingActor = {
  actorId: "publisher-1",
  organizationId: "org-grace",
  campusId: "campus-central",
  handoffRole: "PUBLISHER",
};

function approvedContent(
  overrides: Partial<ApprovedPublicationContent> = {},
): ApprovedPublicationContent {
  return {
    organizationId: "org-grace",
    campusId: "campus-central",
    sourceType: "CLIP",
    sourceId: "clip-1",
    approvedRevisionId: "revision-4",
    platform: "Instagram",
    socialAccountId: "account-1",
    title: "Hope in the waiting",
    caption: "God remains faithful in the waiting.",
    hashtags: ["#Hope"],
    mediaObjectKey: "org-grace/clips/clip-1/final.mp4",
    mediaChecksumSha256: "a".repeat(64),
    ...overrides,
  };
}

function approvedReceipt(
  overrides: Partial<ApprovedPublicationContent> = {},
): ApprovedPreviewReceipt {
  const result = sealApprovedPreview({
    approvalState: "APPROVED",
    approvedAt: "2026-08-21T08:00:00.000Z",
    approvedByActorRef: "pastor-approver-1",
    content: approvedContent(overrides),
  });
  if (!result.ok) throw new Error(result.reasons.join(","));
  return result.receipt;
}

function scheduledPayload(
  receipt: ApprovedPreviewReceipt,
  overrides: Partial<ScheduledPublicationPayload> = {},
): ScheduledPublicationPayload {
  return {
    ...receipt.content,
    scheduledPostId: "scheduled-1",
    approvedPreviewIdentity: receipt.approvedPreviewIdentity,
    ...overrides,
  };
}

function readyIntent() {
  const receipt = approvedReceipt();
  const result = createGovernedPublishIntent({
    actor: publisher,
    approvedPreview: receipt,
    scheduledPayload: scheduledPayload(receipt),
    connectorId: "noop-local",
    explicitPublishIntent: true,
    intentId: "intent-1",
    requestedAt: new Date("2026-08-21T09:00:00.000Z"),
  });
  if (result.status !== "READY") throw new Error(result.details.join(","));
  return result.intent;
}

describe("governed publishing intent", () => {
  it("defaults every accepted connector handoff to private with auto-publish off", () => {
    const intent = readyIntent();

    expect(intent).toMatchObject({
      requestedVisibility: "PRIVATE",
      explicitPublishIntent: true,
      autoPublish: false,
      approvedRevisionId: "revision-4",
      approvedByActorRef: "pastor-approver-1",
    });
  });

  it("blocks when content changes after the pastor's approved revision", () => {
    const receipt = approvedReceipt();
    const result = createGovernedPublishIntent({
      actor: publisher,
      approvedPreview: receipt,
      scheduledPayload: scheduledPayload(receipt, {
        caption: "Changed after approval",
      }),
      connectorId: "noop-local",
      explicitPublishIntent: true,
    });

    expect(result).toMatchObject({
      status: "BLOCKED",
      reasons: expect.arrayContaining(["APPROVAL_OR_PAYLOAD_INVALID"]),
      details: expect.arrayContaining(["SCHEDULED_PAYLOAD_CHANGED"]),
    });
  });

  it("requires explicit intent and the publisher handoff role", () => {
    const receipt = approvedReceipt();
    const result = createGovernedPublishIntent({
      actor: { ...publisher, handoffRole: "PASTOR_APPROVER" },
      approvedPreview: receipt,
      scheduledPayload: scheduledPayload(receipt),
      connectorId: "noop-local",
      explicitPublishIntent: false,
    });

    expect(result).toMatchObject({
      status: "BLOCKED",
      reasons: expect.arrayContaining([
        "EXPLICIT_PUBLISH_INTENT_REQUIRED",
        "ROLE_NOT_AUTHORIZED",
      ]),
    });
  });

  it("denies cross-tenant connector intent even with a valid approval receipt", () => {
    const receipt = approvedReceipt();
    const result = createGovernedPublishIntent({
      actor: { ...publisher, organizationId: "org-other" },
      approvedPreview: receipt,
      scheduledPayload: scheduledPayload(receipt),
      connectorId: "noop-local",
      explicitPublishIntent: true,
    });

    expect(result).toMatchObject({
      status: "BLOCKED",
      reasons: expect.arrayContaining(["TENANT_SCOPE_MISMATCH"]),
    });
  });

  it("rejects a connector idempotency key copied from a different intent", () => {
    const receipt = approvedReceipt();
    const result = createGovernedPublishIntent({
      actor: publisher,
      approvedPreview: receipt,
      scheduledPayload: scheduledPayload(receipt),
      connectorId: "noop-local",
      connectorIdempotencyKey: "wrong-key",
      explicitPublishIntent: true,
    });

    expect(result).toMatchObject({
      status: "BLOCKED",
      reasons: expect.arrayContaining(["CONNECTOR_IDEMPOTENCY_MISMATCH"]),
    });
  });
});

describe("no-op connector recovery and audit", () => {
  it("stages no external send and treats a retry as an idempotent replay", async () => {
    const intent = readyIntent();
    const connector = new NoopPublishingConnector();
    const audit = new InMemoryPublishingAuditRepository();

    const first = await stageGovernedPrivateHandoff({ actor: publisher, intent, connector, audit });
    const replay = await stageGovernedPrivateHandoff({ actor: publisher, intent, connector, audit });

    expect(first).toMatchObject({ status: "MANUAL_HANDOFF_REQUIRED", idempotentReplay: false });
    expect(replay).toMatchObject({ status: "MANUAL_HANDOFF_REQUIRED", idempotentReplay: true });
    expect(await audit.list({
      organizationId: publisher.organizationId,
      campusId: publisher.campusId,
      scheduledPostId: intent.scheduledPostId,
    })).toHaveLength(2);
  });

  it("keeps failed reconciliation visible and tenant-isolates audit history", async () => {
    const intent = readyIntent();
    const connector = new NoopPublishingConnector();
    const audit = new InMemoryPublishingAuditRepository();
    connector.setReconciliationResult(intent.connectorIdempotencyKey, {
      status: "FAILED",
      checkedAt: "2026-08-21T10:00:00.000Z",
      connectorReference: "noop:failed",
      detail: "The destination result could not be verified. Check the platform before retrying.",
      retrySafe: false,
    });

    const result = await reconcileGovernedPrivateHandoff({
      actor: publisher,
      intent,
      connector,
      audit,
    });

    expect(result).toMatchObject({ status: "FAILED", retrySafe: false });
    expect((await audit.list({
      organizationId: "org-grace",
      campusId: "campus-central",
    }))[0]).toMatchObject({
      eventType: "RECONCILIATION_RECORDED",
      outcome: "FAILED",
      detail: expect.stringContaining("Check the platform"),
    });
    expect(await audit.list({
      organizationId: "org-other",
      campusId: "campus-central",
    })).toEqual([]);
  });

  it("denies reconciliation by a communications preparer", async () => {
    const intent = readyIntent();
    await expect(reconcileGovernedPrivateHandoff({
      actor: { ...publisher, handoffRole: "COMMUNICATIONS_PREPARER" },
      intent,
      connector: new NoopPublishingConnector(),
      audit: new InMemoryPublishingAuditRepository(),
    })).rejects.toThrow("not authorized");
  });
});
