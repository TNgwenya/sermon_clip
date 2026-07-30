import { describe, expect, it } from "vitest";

import {
  assessDuplicatePublicationGuard,
  buildDuplicatePublicationGuardInputs,
  sealApprovedPreview,
  verifyScheduledPayloadIdentity,
  type ApprovedPublicationContent,
  type ApprovedPreviewReceipt,
  type DuplicatePublicationGuardInputs,
  type ScheduledPublicationPayload,
} from "./publicationIntegrity";

function approvedContent(
  overrides: Partial<ApprovedPublicationContent> = {},
): ApprovedPublicationContent {
  return {
    organizationId: "org-grace",
    campusId: "campus-central",
    sourceType: "CLIP",
    sourceId: "clip-1",
    approvedRevisionId: "clip-approval-7",
    platform: "Instagram",
    socialAccountId: "instagram-grace",
    title: "Peace in the storm",
    caption: "God remains near when the storm feels loud.",
    hashtags: ["#Peace", "#Faith"],
    mediaObjectKey: "org-grace/clips/clip-1/final.mp4",
    mediaChecksumSha256: "a".repeat(64),
    ...overrides,
  };
}

function receipt(
  overrides: Partial<ApprovedPublicationContent> = {},
): ApprovedPreviewReceipt {
  const result = sealApprovedPreview({
    approvalState: "APPROVED",
    approvedAt: "2026-07-28T10:00:00.000Z",
    approvedByActorRef: "user-pastor",
    content: approvedContent(overrides),
  });
  if (!result.ok) throw new Error(result.reasons.join(","));
  return result.receipt;
}

function scheduledPayload(
  approved: ApprovedPreviewReceipt,
  overrides: Partial<ScheduledPublicationPayload> = {},
): ScheduledPublicationPayload {
  return {
    ...approved.content,
    scheduledPostId: "scheduled-1",
    approvedPreviewIdentity: approved.approvedPreviewIdentity,
    ...overrides,
  };
}

function guard(): DuplicatePublicationGuardInputs {
  const approved = receipt();
  const result = buildDuplicatePublicationGuardInputs({
    approvedPreview: approved,
    scheduledPayload: scheduledPayload(approved),
  });
  if (!result.ok) throw new Error(result.reasons.join(","));
  return result.guard;
}

describe("approved preview and scheduled payload identity", () => {
  it("seals an approved preview and verifies the unchanged scheduled payload", () => {
    const approved = receipt();

    expect(verifyScheduledPayloadIdentity({
      approvedPreview: approved,
      scheduledPayload: scheduledPayload(approved),
    })).toEqual({
      status: "VERIFIED",
      approvedPreviewIdentity: approved.approvedPreviewIdentity,
    });
  });

  it("normalizes harmless line-ending and Unicode representation differences", () => {
    const approved = receipt({
      title: "God’s peace",
      caption: "First line\r\nSecond line",
    });

    expect(verifyScheduledPayloadIdentity({
      approvedPreview: approved,
      scheduledPayload: scheduledPayload(approved, {
        title: "God’s peace".normalize("NFD"),
        caption: "First line\nSecond line",
      }),
    }).status).toBe("VERIFIED");
  });

  it("fails closed if copy or media changes after approval", () => {
    const approved = receipt();

    const verification = verifyScheduledPayloadIdentity({
      approvedPreview: approved,
      scheduledPayload: scheduledPayload(approved, {
        caption: "A stronger promise that was never approved.",
      }),
    });

    expect(verification).toMatchObject({ status: "BLOCKED" });
    if (verification.status === "BLOCKED") {
      expect(verification.reasons).toContain("SCHEDULED_PAYLOAD_CHANGED");
    }
  });

  it("fails closed on a tenant mismatch even if the caller reuses a receipt hash", () => {
    const approved = receipt();

    const verification = verifyScheduledPayloadIdentity({
      approvedPreview: approved,
      scheduledPayload: scheduledPayload(approved, {
        organizationId: "org-other",
      }),
    });

    expect(verification).toMatchObject({
      status: "BLOCKED",
      reasons: expect.arrayContaining([
        "TENANT_SCOPE_MISMATCH",
        "SCHEDULED_PAYLOAD_CHANGED",
      ]),
    });
  });

  it("does not seal drafts or content without a verifiable media checksum", () => {
    expect(sealApprovedPreview({
      approvalState: "DRAFT",
      approvedAt: "not-a-date",
      approvedByActorRef: "",
      content: approvedContent({ mediaChecksumSha256: "" }),
    })).toEqual({
      ok: false,
      reasons: expect.arrayContaining([
        "APPROVAL_REQUIRED",
        "INVALID_APPROVAL_TIMESTAMP",
        "MISSING_REQUIRED_IDENTITY",
        "INVALID_MEDIA_CHECKSUM",
      ]),
    });
  });

  it("rejects a forged receipt even when its content hash is valid", () => {
    const approved = receipt();
    const forged = {
      ...approved,
      approvalState: "DRAFT",
    } as unknown as ApprovedPreviewReceipt;

    expect(verifyScheduledPayloadIdentity({
      approvedPreview: forged,
      scheduledPayload: scheduledPayload(approved),
    })).toMatchObject({
      status: "BLOCKED",
      reasons: expect.arrayContaining(["APPROVAL_REQUIRED"]),
    });
  });
});

describe("duplicate publication guard", () => {
  it("creates deterministic retry, semantic, and destination-payload keys", () => {
    const first = guard();
    const second = guard();

    expect(first).toEqual(second);
    expect(first.retryIdempotencyKey).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.semanticDuplicateKey).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.destinationPayloadKey).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("allows retrying the same in-flight scheduled post with the same key", () => {
    const current = guard();

    expect(assessDuplicatePublicationGuard({
      guard: current,
      records: [{
        organizationId: current.organizationId,
        campusId: current.campusId,
        scheduledPostId: current.scheduledPostId,
        retryIdempotencyKey: current.retryIdempotencyKey,
        semanticDuplicateKey: current.semanticDuplicateKey,
        destinationPayloadKey: current.destinationPayloadKey,
        status: "PUBLISHING",
        externalPostId: null,
      }],
    })).toEqual({
      status: "ALLOW_IDEMPOTENT_RETRY",
      matchingScheduledPostId: "scheduled-1",
    });
  });

  it("blocks a second schedule for the same approved revision and destination", () => {
    const current = guard();

    expect(assessDuplicatePublicationGuard({
      guard: current,
      records: [{
        organizationId: current.organizationId,
        campusId: current.campusId,
        scheduledPostId: "scheduled-earlier",
        retryIdempotencyKey: "different",
        semanticDuplicateKey: current.semanticDuplicateKey,
        destinationPayloadKey: "different",
        status: "CLAIMED",
        externalPostId: null,
      }],
    })).toEqual({
      status: "BLOCKED",
      reason: "DUPLICATE_PUBLICATION",
      matchingScheduledPostId: "scheduled-earlier",
    });
  });

  it("blocks already-published retries instead of sending again", () => {
    const current = guard();

    expect(assessDuplicatePublicationGuard({
      guard: current,
      records: [{
        organizationId: current.organizationId,
        campusId: current.campusId,
        scheduledPostId: current.scheduledPostId,
        retryIdempotencyKey: current.retryIdempotencyKey,
        semanticDuplicateKey: current.semanticDuplicateKey,
        destinationPayloadKey: current.destinationPayloadKey,
        status: "PUBLISHED",
        externalPostId: "external-123",
      }],
    })).toMatchObject({
      status: "BLOCKED",
      reason: "ALREADY_PUBLISHED",
    });
  });

  it("treats an external post id as published even if a stale worker marked the attempt failed", () => {
    const current = guard();

    expect(assessDuplicatePublicationGuard({
      guard: current,
      records: [{
        organizationId: current.organizationId,
        campusId: current.campusId,
        scheduledPostId: current.scheduledPostId,
        retryIdempotencyKey: current.retryIdempotencyKey,
        semanticDuplicateKey: current.semanticDuplicateKey,
        destinationPayloadKey: current.destinationPayloadKey,
        status: "FAILED",
        externalPostId: "external-possibly-published",
      }],
    })).toMatchObject({
      status: "BLOCKED",
      reason: "ALREADY_PUBLISHED",
    });
  });

  it("fails closed when duplicate lookup results contain another tenant", () => {
    const current = guard();

    expect(assessDuplicatePublicationGuard({
      guard: current,
      records: [{
        organizationId: "org-other",
        campusId: current.campusId,
        scheduledPostId: "scheduled-other",
        retryIdempotencyKey: "other",
        semanticDuplicateKey: "other",
        destinationPayloadKey: "other",
        status: "FAILED",
        externalPostId: null,
      }],
    })).toEqual({
      status: "BLOCKED",
      reason: "UNTRUSTED_LOOKUP_RESULT",
      matchingScheduledPostId: null,
    });
  });
});
