import { describe, expect, it } from "vitest";

import {
  WEEK_DRAFT_ITEM_FORMATS,
  assertCurrentApprovalRevision,
  assertWeekDraftItemStatusTransition,
  assertWeekDraftProvenance,
  assertWeekDraftStatusTransition,
  assertWeekDraftTenant,
  evaluateApproval,
  normalizeWeekDraftItemOrder,
  weekDraftTenantWhere,
} from "@/server/weekDraft/domain";

describe("Week Draft domain", () => {
  it("models a mixed-format week without imposing a five-to-seven item ceiling", () => {
    expect(WEEK_DRAFT_ITEM_FORMATS).toEqual(
      expect.arrayContaining([
        "SHORT_FORM_VIDEO",
        "QUOTE_GRAPHIC",
        "CAROUSEL",
        "TEXT_POST",
        "DEVOTIONAL",
        "EMAIL",
        "BLOG",
      ]),
    );

    const eightItems = Array.from({ length: 8 }, (_, index) => `item-${index + 1}`);
    expect([...normalizeWeekDraftItemOrder(eightItems)]).toEqual(
      eightItems.map((id, index) => [id, (index + 1) * 1_024]),
    );
  });

  it("rejects duplicate or incomplete stable ordering identities", () => {
    expect(() => normalizeWeekDraftItemOrder(["item-1", "item-1"])).toThrow(
      /unique/i,
    );
    expect(() => normalizeWeekDraftItemOrder(["item-1", " "])).toThrow(
      /non-empty/i,
    );
  });

  it("enforces the draft and item lifecycle instead of allowing arbitrary status jumps", () => {
    expect(() =>
      assertWeekDraftStatusTransition("DRAFT", "READY_FOR_REVIEW"),
    ).not.toThrow();
    expect(() =>
      assertWeekDraftStatusTransition("DRAFT", "PUBLISHED"),
    ).toThrow(/cannot move/i);

    expect(() =>
      assertWeekDraftItemStatusTransition("IN_REVIEW", "APPROVED"),
    ).not.toThrow();
    expect(() =>
      assertWeekDraftItemStatusTransition("PUBLISHED", "DRAFT"),
    ).toThrow(/cannot move/i);
  });

  it("fails closed on organization and campus mismatches", () => {
    expect(
      weekDraftTenantWhere({ organizationId: "org-1", campusId: "campus-1" }),
    ).toEqual({ organizationId: "org-1", campusId: "campus-1" });
    expect(() =>
      assertWeekDraftTenant(
        { organizationId: "org-1", campusId: "campus-1" },
        { organizationId: "org-1", campusId: "campus-2" },
      ),
    ).toThrow(/active tenant/i);
    expect(() =>
      assertWeekDraftTenant(
        { organizationId: "org-1" },
        { organizationId: "org-2", campusId: null },
      ),
    ).toThrow(/active tenant/i);
  });

  it("requires explicit provenance for generated and imported items", () => {
    expect(() =>
      assertWeekDraftProvenance({
        sourceType: "CLIP_CANDIDATE",
        sourceId: "clip-1",
      }),
    ).not.toThrow();
    expect(() =>
      assertWeekDraftProvenance({ sourceType: "CONTENT_ASSET" }),
    ).toThrow(/source identity/i);
    expect(() =>
      assertWeekDraftProvenance({
        sourceType: "MANUAL",
        sourceId: "pretend-source",
      }),
    ).toThrow(/cannot claim/i);
  });

  it("binds approval to the exact current revision", () => {
    expect(() =>
      assertCurrentApprovalRevision("revision-3", "revision-3"),
    ).not.toThrow();
    expect(() =>
      assertCurrentApprovalRevision("revision-4", "revision-3"),
    ).toThrow(/older item revision/i);
  });

  it("supports quorum and all-required-role policies with distinct decisions", () => {
    const quorum = evaluateApproval(
      {
        policyId: "policy-1",
        policyName: "Two-person review",
        mode: "QUORUM",
        minimumApprovals: 2,
        allowSelfApproval: false,
        rules: [
          { role: "PASTOR_APPROVER", minimumApprovals: 1 },
          { role: "CONTENT_LEAD", minimumApprovals: 1 },
        ],
      },
      [
        { userId: "pastor", role: "PASTOR_APPROVER", decision: "APPROVE" },
        { userId: "lead", role: "CONTENT_LEAD", decision: "APPROVE" },
      ],
    );
    expect(quorum).toEqual({ status: "APPROVED", approvals: 2 });

    const allRolesPending = evaluateApproval(
      {
        policyId: "policy-2",
        policyName: "Pastor and publisher",
        mode: "ALL_REQUIRED_ROLES",
        minimumApprovals: 2,
        allowSelfApproval: false,
        rules: [
          { role: "PASTOR_APPROVER", minimumApprovals: 1 },
          { role: "PUBLISHER", minimumApprovals: 1 },
        ],
      },
      [
        { userId: "pastor-1", role: "PASTOR_APPROVER", decision: "APPROVE" },
        { userId: "pastor-2", role: "PASTOR_APPROVER", decision: "APPROVE" },
      ],
    );
    expect(allRolesPending).toEqual({ status: "PENDING", approvals: 2 });
  });

  it("lets any eligible change request stop approval immediately", () => {
    const result = evaluateApproval(
      {
        policyId: "policy-1",
        policyName: "Pastor review",
        mode: "ANY_APPROVER",
        minimumApprovals: 1,
        allowSelfApproval: false,
        rules: [{ role: "PASTOR_APPROVER", minimumApprovals: 1 }],
      },
      [
        {
          userId: "pastor",
          role: "PASTOR_APPROVER",
          decision: "REQUEST_CHANGES",
        },
      ],
    );
    expect(result).toEqual({ status: "CHANGES_REQUESTED", approvals: 0 });
  });
});
