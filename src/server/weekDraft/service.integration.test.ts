import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import {
  createApprovalPolicy,
  decideWeekDraftItemApproval,
  requestWeekDraftItemApproval,
} from "@/server/collaboration/approvalService";
import {
  addWeekDraftComment,
  assignWeekDraftWork,
} from "@/server/collaboration/service";
import {
  appendWeekDraftItemRevision,
  createWeekDraft,
  transitionWeekDraftItemStatus,
  transitionWeekDraftStatus,
} from "@/server/weekDraft/service";

const runIntegration = process.env.RUN_WEEK_DRAFT_INTEGRATION_TESTS === "1";
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const organizationId = `week-draft-org-${suffix}`;
const otherOrganizationId = `week-draft-other-org-${suffix}`;
const campusId = `week-draft-campus-${suffix}`;
const otherCampusId = `week-draft-other-campus-${suffix}`;
const editorId = `week-draft-editor-${suffix}`;
const pastorId = `week-draft-pastor-${suffix}`;
const sermonId = `week-draft-sermon-${suffix}`;

afterAll(async () => {
  if (!runIntegration) {
    return;
  }
  await prisma.weekDraft.deleteMany({
    where: { organizationId: { in: [organizationId, otherOrganizationId] } },
  });
  await prisma.approvalPolicy.deleteMany({
    where: { organizationId: { in: [organizationId, otherOrganizationId] } },
  });
  await prisma.sermon.deleteMany({
    where: { organizationId: { in: [organizationId, otherOrganizationId] } },
  });
  await prisma.membership.deleteMany({
    where: { organizationId: { in: [organizationId, otherOrganizationId] } },
  });
  await prisma.campus.deleteMany({
    where: { organizationId: { in: [organizationId, otherOrganizationId] } },
  });
  await prisma.user.deleteMany({ where: { id: { in: [editorId, pastorId] } } });
  await prisma.organization.deleteMany({
    where: { id: { in: [organizationId, otherOrganizationId] } },
  });
});

describe.runIf(runIntegration)("Week Draft persistence integration", () => {
  it("persists a mixed week and protects its approval revision across tenants", async () => {
    await prisma.organization.createMany({
      data: [
        {
          id: organizationId,
          slug: `week-draft-${suffix}`,
          name: "Week Draft Church",
        },
        {
          id: otherOrganizationId,
          slug: `week-draft-other-${suffix}`,
          name: "Other Church",
        },
      ],
    });
    await prisma.campus.createMany({
      data: [
        {
          id: campusId,
          organizationId,
          slug: "main",
          name: "Main Campus",
        },
        {
          id: otherCampusId,
          organizationId: otherOrganizationId,
          slug: "main",
          name: "Other Campus",
        },
      ],
    });
    await prisma.user.createMany({
      data: [
        {
          id: editorId,
          email: `${editorId}@example.test`,
          normalizedEmail: `${editorId}@example.test`,
          status: "ACTIVE",
        },
        {
          id: pastorId,
          email: `${pastorId}@example.test`,
          normalizedEmail: `${pastorId}@example.test`,
          status: "ACTIVE",
        },
      ],
    });
    await prisma.membership.createMany({
      data: [
        {
          organizationId,
          campusId,
          userId: editorId,
          role: "CONTENT_LEAD",
          status: "ACTIVE",
        },
        {
          organizationId,
          campusId,
          userId: pastorId,
          role: "PASTOR_APPROVER",
          status: "ACTIVE",
        },
      ],
    });
    await prisma.sermon.create({
      data: {
        id: sermonId,
        organizationId,
        campusId,
        youtubeUrl: "https://example.test/week-draft-sermon",
        title: "Hope for the Week",
        speakerName: "Pastor Test",
        churchName: "Week Draft Church",
        language: "English",
        rightsConfirmed: true,
      },
    });

    const formats = [
      "SHORT_FORM_VIDEO",
      "QUOTE_GRAPHIC",
      "CAROUSEL",
      "TEXT_POST",
      "DEVOTIONAL",
      "PRAYER",
      "EMAIL",
      "BLOG",
    ] as const;
    const draft = await prisma.$transaction((tx) =>
      createWeekDraft(tx, {
        tenant: { organizationId, campusId },
        sermonId,
        title: "Hope for the Week",
        weekStartsOn: new Date("2026-08-03T00:00:00.000Z"),
        timezone: "Africa/Johannesburg",
        createdByUserId: editorId,
        items: formats.map((format, index) => ({
          format,
          title: `${format} ${index + 1}`,
          payload: { text: `Week item ${index + 1}` },
          sourceType: "MANUAL",
        })),
      }),
    );
    expect(draft.itemIds).toHaveLength(8);

    await prisma.$transaction(async (tx) => {
      for (const weekDraftItemId of draft.itemIds) {
        await transitionWeekDraftItemStatus(tx, {
          tenant: { organizationId, campusId },
          weekDraftItemId,
          status: "READY_FOR_REVIEW",
        });
      }
      await transitionWeekDraftStatus(tx, {
        tenant: { organizationId, campusId },
        weekDraftId: draft.id,
        status: "READY_FOR_REVIEW",
      });
    });

    const policy = await prisma.$transaction((tx) =>
      createApprovalPolicy(tx, {
        tenant: { organizationId, campusId },
        name: "Pastor approval",
        mode: "ANY_APPROVER",
        minimumApprovals: 1,
        createdByUserId: editorId,
        rules: [
          {
            role: "PASTOR_APPROVER",
            minimumApprovals: 1,
          },
        ],
      }),
    );
    const request = await prisma.$transaction((tx) =>
      requestWeekDraftItemApproval(tx, {
        tenant: { organizationId, campusId },
        weekDraftItemId: draft.itemIds[0],
        approvalPolicyId: policy.id,
        requestedByUserId: editorId,
      }),
    );
    const decision = await prisma.$transaction((tx) =>
      decideWeekDraftItemApproval(tx, {
        tenant: { organizationId, campusId },
        approvalRequestId: request.id,
        decidedByUserId: pastorId,
        decidedAsRole: "PASTOR_APPROVER",
        decision: "APPROVE",
      }),
    );
    expect(decision).toEqual({ status: "APPROVED", approvals: 1 });

    await prisma.$transaction((tx) =>
      addWeekDraftComment(tx, {
        tenant: { organizationId, campusId },
        weekDraftId: draft.id,
        weekDraftItemId: draft.itemIds[0],
        authorUserId: editorId,
        body: "Approved version is ready.",
        mentionedUserIds: [pastorId],
      }),
    );
    await prisma.$transaction((tx) =>
      assignWeekDraftWork(tx, {
        tenant: { organizationId, campusId },
        weekDraftId: draft.id,
        weekDraftItemId: draft.itemIds[1],
        assigneeUserId: editorId,
        assignedByUserId: editorId,
        dueAt: new Date("2026-08-05T12:00:00.000Z"),
      }),
    );

    await expect(
      prisma.$transaction((tx) =>
        appendWeekDraftItemRevision(tx, {
          tenant: {
            organizationId: otherOrganizationId,
            campusId: otherCampusId,
          },
          weekDraftItemId: draft.itemIds[0],
          payload: { text: "Cross-tenant edit" },
          createdByUserId: editorId,
        }),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const approvedItem = await prisma.weekDraftItem.findUniqueOrThrow({
      where: { id: draft.itemIds[0] },
      select: {
        currentRevisionId: true,
        approvedRevisionId: true,
        status: true,
        comments: { select: { mentions: true } },
      },
    });
    expect(approvedItem).toMatchObject({
      status: "APPROVED",
      currentRevisionId: request.revisionId,
      approvedRevisionId: request.revisionId,
    });
    expect(approvedItem.comments[0]?.mentions).toHaveLength(1);
  });
});
