import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  buildGovernedPublishingHandoffModel,
  GovernedPublishingHandoff,
  type HandoffPost,
} from "@/app/ready-to-post/governed-publishing-handoff";

function post(overrides: Partial<HandoffPost> = {}): HandoffPost {
  return {
    id: "post-1",
    platform: "Instagram",
    socialAccountLabel: null,
    clipIds: ["clip-1"],
    title: "Hope in the waiting",
    caption: "God remains faithful.",
    automationMode: "MANUAL",
    scheduledFor: null,
    timezone: null,
    status: "READY_FOR_MEDIA_TEAM",
    workerStatus: "IDLE",
    workerId: null,
    publishError: null,
    finalPrivacyStatus: null,
    externalPostId: null,
    publishedUrl: null,
    compositionReceipt: [{
      schemaVersion: 1,
      clipId: "clip-1",
      editPlanId: "plan-1",
      artifactId: "artifact-1",
      planHash: "a".repeat(64),
      filePath: "/private/final.mp4",
      sizeBytes: 100,
      snapshotSha256: null,
      snapshotSizeBytes: null,
    }],
    contentAssets: [],
    ...overrides,
  };
}

describe("GovernedPublishingHandoff", () => {
  it("shows role-oriented responsibilities without claiming dynamic role personalization", () => {
    const markup = renderToStaticMarkup(<GovernedPublishingHandoff post={post()} />);

    expect(markup).toContain("Pastor approval");
    expect(markup).toContain("Communications preparation");
    expect(markup).toContain("Publisher preflight");
    expect(markup).toContain("not claims about the signed-in person");
    expect(markup).toContain("Private/manual by default");
    expect(markup).toContain("cannot call a provider or publish a post");
  });

  it("surfaces failed reconciliation with manual verification before retry", () => {
    const model = buildGovernedPublishingHandoffModel({
      post: post({
        automationMode: "AUTOMATIC",
        status: "PRIVATE_ONLY_UNVERIFIED",
        workerStatus: "FAILED",
        publishError: "Provider result unknown",
      }),
    });

    expect(model.nextAction).toContain("actual visibility");
    expect(model.recovery).toContain("Do not retry");
    expect(model.recovery).toContain("manual handoff");
    expect(model.stages[2]).toMatchObject({ state: "ATTENTION" });
  });

  it("fails closed when a content revision changed after approval", () => {
    const model = buildGovernedPublishingHandoffModel({
      post: post({
        compositionReceipt: null,
        automationMode: "AUTOMATIC",
        contentAssets: [{
          id: "asset-1",
          revisionId: "revision-8",
          revisionApprovalState: "REAPPROVAL_REQUIRED",
          title: "Changed quote",
          assetType: "QUOTE_GRAPHIC",
          status: "IN_REVIEW",
          caption: "Changed after approval",
          bodyContent: null,
          callToAction: null,
          hashtags: [],
          files: [],
        }],
      }),
    });

    expect(model.stages[0]).toMatchObject({ state: "ATTENTION" });
    expect(model.approvalTrace).toContain("Reapproval Required");
    expect(model.approvalTrace).toContain("handoff blocked");
    expect(model.nextAction).toContain("pastor approval");
    expect(model.recovery).toContain("changed after approval");
  });

  it("makes a missing owner assignment visible instead of inferring a person", () => {
    const model = buildGovernedPublishingHandoffModel({ post: post() });
    expect(model.owner).toBe("Communications responsibility · person not assigned");
    expect(model.assignee).toBe("Not assigned");
  });

  it("shows exact source revision, destination, ownership, and schedule evidence", () => {
    const model = buildGovernedPublishingHandoffModel({
      post: post({
        socialAccountLabel: "Grace Church Instagram",
        scheduledFor: "2026-08-23T08:00:00.000Z",
        timezone: "Africa/Johannesburg",
        contentAssets: [{
          id: "asset-1",
          sermonId: "sermon-1",
          sermonTitle: "Sunday Hope",
          revisionId: "revision-7",
          revisionApprovalState: "APPROVED",
          title: "Hope quote",
          assetType: "QUOTE_GRAPHIC",
          status: "APPROVED",
          caption: "Hope",
          bodyContent: null,
          callToAction: null,
          hashtags: [],
          files: [],
        }],
      }),
      ownerLabel: "Communications team",
      assigneeLabel: "Publishing coordinator",
    });

    expect(model.sourceTrace).toContain("Sunday Hope · Hope quote");
    expect(model.approvalTrace).toBe("Approved revision revision-7");
    expect(model.destination).toBe("Instagram · Grace Church Instagram");
    expect(model.owner).toBe("Communications team");
    expect(model.assignee).toBe("Publishing coordinator");
    expect(model.schedule).toContain("Africa/Johannesburg");
  });
});
