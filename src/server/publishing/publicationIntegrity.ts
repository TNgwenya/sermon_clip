import { createHash } from "node:crypto";

import type { PostingPlatform } from "@/lib/postingDrafts";

export type PublicationTenantScope = {
  organizationId: string;
  campusId: string | null;
};

export type ApprovedPublicationContent = PublicationTenantScope & {
  sourceType: "CLIP" | "CONTENT_ASSET";
  sourceId: string;
  approvedRevisionId: string;
  platform: PostingPlatform;
  socialAccountId: string;
  title: string;
  caption: string;
  hashtags: string[];
  mediaObjectKey: string;
  mediaChecksumSha256: string;
};

export type ApprovedPreviewReceipt = {
  receiptVersion: 1;
  approvalState: "APPROVED";
  approvedAt: string;
  approvedByActorRef: string;
  content: ApprovedPublicationContent;
  approvedPreviewIdentity: string;
};

export type ScheduledPublicationPayload = ApprovedPublicationContent & {
  scheduledPostId: string;
  approvedPreviewIdentity: string;
};

export type PublicationIdentityBlockReason =
  | "APPROVAL_REQUIRED"
  | "INVALID_APPROVAL_TIMESTAMP"
  | "MISSING_REQUIRED_IDENTITY"
  | "INVALID_MEDIA_CHECKSUM"
  | "INVALID_APPROVED_PREVIEW_IDENTITY"
  | "TENANT_SCOPE_MISMATCH"
  | "SCHEDULED_PAYLOAD_CHANGED";

export type ApprovedPreviewSealResult =
  | { ok: true; receipt: ApprovedPreviewReceipt }
  | { ok: false; reasons: PublicationIdentityBlockReason[] };

export type ScheduledPayloadVerification =
  | {
      status: "VERIFIED";
      approvedPreviewIdentity: string;
    }
  | {
      status: "BLOCKED";
      reasons: PublicationIdentityBlockReason[];
    };

export type DuplicatePublicationGuardInputs = {
  organizationId: string;
  campusId: string | null;
  scheduledPostId: string;
  socialAccountId: string;
  platform: PostingPlatform;
  sourceType: ApprovedPublicationContent["sourceType"];
  sourceId: string;
  approvedRevisionId: string;
  approvedPreviewIdentity: string;
  /**
   * Stable for retries of this scheduled post. A publisher should persist and
   * reuse it when calling the external platform.
   */
  retryIdempotencyKey: string;
  /**
   * Stable across different schedules of the same approved revision to the
   * same destination. Query this before claiming a publication.
   */
  semanticDuplicateKey: string;
  /**
   * Detects the same approved bytes and copy being sent to the same account,
   * even if an upstream source identifier was accidentally replaced.
   */
  destinationPayloadKey: string;
};

export type DuplicatePublicationRecord = {
  organizationId: string;
  campusId: string | null;
  scheduledPostId: string;
  retryIdempotencyKey: string;
  semanticDuplicateKey: string;
  destinationPayloadKey: string;
  status: "CLAIMED" | "PUBLISHING" | "PUBLISHED" | "FAILED" | "CANCELLED";
  externalPostId: string | null;
};

export type DuplicatePublicationAssessment =
  | {
      status: "ALLOW_NEW_ATTEMPT" | "ALLOW_IDEMPOTENT_RETRY";
      matchingScheduledPostId: string | null;
    }
  | {
      status: "BLOCKED";
      reason:
        | "UNTRUSTED_LOOKUP_RESULT"
        | "DUPLICATE_PUBLICATION"
        | "ALREADY_PUBLISHED";
      matchingScheduledPostId: string | null;
    };

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const ACTIVE_PUBLICATION_STATES = new Set<DuplicatePublicationRecord["status"]>([
  "CLAIMED",
  "PUBLISHING",
  "PUBLISHED",
]);

function normalizeString(value: string): string {
  return value.normalize("NFKC").replace(/\r\n?/gu, "\n").trim();
}

function requiredIdentityValues(content: ApprovedPublicationContent): string[] {
  return [
    content.organizationId,
    content.sourceId,
    content.approvedRevisionId,
    content.platform,
    content.socialAccountId,
    content.mediaObjectKey,
  ];
}

function canonicalPublicationContent(content: ApprovedPublicationContent) {
  return {
    organizationId: normalizeString(content.organizationId),
    campusId: content.campusId ? normalizeString(content.campusId) : null,
    sourceType: content.sourceType,
    sourceId: normalizeString(content.sourceId),
    approvedRevisionId: normalizeString(content.approvedRevisionId),
    platform: content.platform,
    socialAccountId: normalizeString(content.socialAccountId),
    title: normalizeString(content.title),
    caption: normalizeString(content.caption),
    hashtags: content.hashtags.map(normalizeString),
    mediaObjectKey: normalizeString(content.mediaObjectKey),
    mediaChecksumSha256: normalizeString(content.mediaChecksumSha256).toLowerCase(),
  };
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function uniqueReasons(
  reasons: PublicationIdentityBlockReason[],
): PublicationIdentityBlockReason[] {
  return [...new Set(reasons)];
}

function validateContentIdentity(
  content: ApprovedPublicationContent,
): PublicationIdentityBlockReason[] {
  const reasons: PublicationIdentityBlockReason[] = [];
  if (requiredIdentityValues(content).some((value) => !normalizeString(value))) {
    reasons.push("MISSING_REQUIRED_IDENTITY");
  }
  if (!SHA256_PATTERN.test(normalizeString(content.mediaChecksumSha256).toLowerCase())) {
    reasons.push("INVALID_MEDIA_CHECKSUM");
  }
  return reasons;
}

export function createApprovedPreviewIdentity(
  content: ApprovedPublicationContent,
): string {
  return sha256({
    identityVersion: 1,
    content: canonicalPublicationContent(content),
  });
}

export function sealApprovedPreview(input: {
  approvalState: string;
  approvedAt: string;
  approvedByActorRef: string;
  content: ApprovedPublicationContent;
}): ApprovedPreviewSealResult {
  const reasons = validateContentIdentity(input.content);
  if (input.approvalState !== "APPROVED") {
    reasons.push("APPROVAL_REQUIRED");
  }
  if (
    !normalizeString(input.approvedAt)
    || Number.isNaN(Date.parse(input.approvedAt))
  ) {
    reasons.push("INVALID_APPROVAL_TIMESTAMP");
  }
  if (!normalizeString(input.approvedByActorRef)) {
    reasons.push("MISSING_REQUIRED_IDENTITY");
  }

  if (reasons.length > 0) {
    return { ok: false, reasons: uniqueReasons(reasons) };
  }

  return {
    ok: true,
    receipt: {
      receiptVersion: 1,
      approvalState: "APPROVED",
      approvedAt: new Date(input.approvedAt).toISOString(),
      approvedByActorRef: normalizeString(input.approvedByActorRef),
      content: structuredClone(input.content),
      approvedPreviewIdentity: createApprovedPreviewIdentity(input.content),
    },
  };
}

export function verifyScheduledPayloadIdentity(input: {
  approvedPreview: ApprovedPreviewReceipt;
  scheduledPayload: ScheduledPublicationPayload;
}): ScheduledPayloadVerification {
  const reasons = [
    ...validateContentIdentity(input.approvedPreview.content),
    ...validateContentIdentity(input.scheduledPayload),
  ];
  const sealedIdentity = createApprovedPreviewIdentity(input.approvedPreview.content);
  const scheduledIdentity = createApprovedPreviewIdentity(input.scheduledPayload);

  if (
    input.approvedPreview.receiptVersion !== 1
    || input.approvedPreview.approvalState !== "APPROVED"
  ) {
    reasons.push("APPROVAL_REQUIRED");
  }
  if (
    !normalizeString(input.approvedPreview.approvedAt)
    || Number.isNaN(Date.parse(input.approvedPreview.approvedAt))
  ) {
    reasons.push("INVALID_APPROVAL_TIMESTAMP");
  }
  if (!normalizeString(input.approvedPreview.approvedByActorRef)) {
    reasons.push("MISSING_REQUIRED_IDENTITY");
  }
  if (
    !SHA256_PATTERN.test(input.approvedPreview.approvedPreviewIdentity)
    || input.approvedPreview.approvedPreviewIdentity !== sealedIdentity
    || input.scheduledPayload.approvedPreviewIdentity !== sealedIdentity
  ) {
    reasons.push("INVALID_APPROVED_PREVIEW_IDENTITY");
  }
  if (
    input.approvedPreview.content.organizationId
      !== input.scheduledPayload.organizationId
    || input.approvedPreview.content.campusId
      !== input.scheduledPayload.campusId
  ) {
    reasons.push("TENANT_SCOPE_MISMATCH");
  }
  if (sealedIdentity !== scheduledIdentity) {
    reasons.push("SCHEDULED_PAYLOAD_CHANGED");
  }
  if (!normalizeString(input.scheduledPayload.scheduledPostId)) {
    reasons.push("MISSING_REQUIRED_IDENTITY");
  }

  const unique = uniqueReasons(reasons);
  return unique.length > 0
    ? { status: "BLOCKED", reasons: unique }
    : { status: "VERIFIED", approvedPreviewIdentity: sealedIdentity };
}

export function buildDuplicatePublicationGuardInputs(input: {
  approvedPreview: ApprovedPreviewReceipt;
  scheduledPayload: ScheduledPublicationPayload;
}):
  | { ok: true; guard: DuplicatePublicationGuardInputs }
  | { ok: false; reasons: PublicationIdentityBlockReason[] } {
  const verification = verifyScheduledPayloadIdentity(input);
  if (verification.status === "BLOCKED") {
    return { ok: false, reasons: verification.reasons };
  }

  const content = canonicalPublicationContent(input.scheduledPayload);
  const tenant = {
    organizationId: content.organizationId,
    campusId: content.campusId,
  };
  return {
    ok: true,
    guard: {
      ...tenant,
      scheduledPostId: normalizeString(input.scheduledPayload.scheduledPostId),
      socialAccountId: content.socialAccountId,
      platform: content.platform,
      sourceType: content.sourceType,
      sourceId: content.sourceId,
      approvedRevisionId: content.approvedRevisionId,
      approvedPreviewIdentity: verification.approvedPreviewIdentity,
      retryIdempotencyKey: sha256({
        purpose: "publication-retry",
        tenant,
        scheduledPostId: normalizeString(input.scheduledPayload.scheduledPostId),
        approvedPreviewIdentity: verification.approvedPreviewIdentity,
        socialAccountId: content.socialAccountId,
        platform: content.platform,
      }),
      semanticDuplicateKey: sha256({
        purpose: "publication-semantic-duplicate",
        tenant,
        sourceType: content.sourceType,
        sourceId: content.sourceId,
        approvedRevisionId: content.approvedRevisionId,
        socialAccountId: content.socialAccountId,
        platform: content.platform,
      }),
      destinationPayloadKey: sha256({
        purpose: "publication-destination-payload",
        tenant,
        approvedPreviewIdentity: verification.approvedPreviewIdentity,
        socialAccountId: content.socialAccountId,
        platform: content.platform,
      }),
    },
  };
}

export function assessDuplicatePublicationGuard(input: {
  guard: DuplicatePublicationGuardInputs;
  records: readonly DuplicatePublicationRecord[];
}): DuplicatePublicationAssessment {
  const untrustedRecord = input.records.find((record) => (
    record.organizationId !== input.guard.organizationId
    || record.campusId !== input.guard.campusId
  ));
  if (untrustedRecord) {
    return {
      status: "BLOCKED",
      reason: "UNTRUSTED_LOOKUP_RESULT",
      matchingScheduledPostId: null,
    };
  }

  const externalPublication = input.records.find((record) => (
    Boolean(record.externalPostId)
    && (
      record.retryIdempotencyKey === input.guard.retryIdempotencyKey
      || record.semanticDuplicateKey === input.guard.semanticDuplicateKey
      || record.destinationPayloadKey === input.guard.destinationPayloadKey
    )
  ));
  if (externalPublication) {
    return {
      status: "BLOCKED",
      reason: "ALREADY_PUBLISHED",
      matchingScheduledPostId: externalPublication.scheduledPostId,
    };
  }

  const retry = input.records.find((record) => (
    record.status !== "CANCELLED"
    && record.scheduledPostId === input.guard.scheduledPostId
    && record.retryIdempotencyKey === input.guard.retryIdempotencyKey
  ));
  if (retry) {
    if (retry.status === "PUBLISHED") {
      return {
        status: "BLOCKED",
        reason: "ALREADY_PUBLISHED",
        matchingScheduledPostId: retry.scheduledPostId,
      };
    }
    return {
      status: "ALLOW_IDEMPOTENT_RETRY",
      matchingScheduledPostId: retry.scheduledPostId,
    };
  }

  const activeRecords = input.records.filter((record) => (
    ACTIVE_PUBLICATION_STATES.has(record.status)
  ));
  const duplicate = activeRecords.find((record) => (
    record.semanticDuplicateKey === input.guard.semanticDuplicateKey
    || record.destinationPayloadKey === input.guard.destinationPayloadKey
  ));
  if (duplicate) {
    return {
      status: "BLOCKED",
      reason: duplicate.status === "PUBLISHED"
        ? "ALREADY_PUBLISHED"
        : "DUPLICATE_PUBLICATION",
      matchingScheduledPostId: duplicate.scheduledPostId,
    };
  }

  return { status: "ALLOW_NEW_ATTEMPT", matchingScheduledPostId: null };
}
