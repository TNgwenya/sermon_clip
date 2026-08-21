import type { ScheduledPost } from "@/lib/scheduledPosts";

import styles from "./governed-publishing-handoff.module.css";

export type HandoffPost = Pick<
  ScheduledPost,
  | "id"
  | "platform"
  | "socialAccountLabel"
  | "clipIds"
  | "title"
  | "caption"
  | "automationMode"
  | "scheduledFor"
  | "timezone"
  | "status"
  | "workerStatus"
  | "workerId"
  | "publishError"
  | "finalPrivacyStatus"
  | "externalPostId"
  | "publishedUrl"
  | "compositionReceipt"
  | "contentAssets"
>;

export type GovernedPublishingHandoffModel = {
  stages: Array<{
    label: string;
    responsibility: string;
    state: "COMPLETE" | "CURRENT" | "WAITING" | "ATTENTION";
  }>;
  sourceTrace: string;
  approvalTrace: string;
  owner: string;
  assignee: string;
  destination: string;
  audience: string;
  privacy: string;
  schedule: string;
  nextAction: string;
  recovery: string | null;
};

function readableStatus(value: string): string {
  return value.toLowerCase().replace(/_/gu, " ").replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

export function buildGovernedPublishingHandoffModel(input: {
  post: HandoffPost;
  ownerLabel?: string | null;
  assigneeLabel?: string | null;
}): GovernedPublishingHandoffModel {
  const { post } = input;
  const approvalRevision = post.contentAssets?.find((asset) => asset.revisionId)?.revisionId ?? null;
  const approvalState = post.contentAssets?.find((asset) => asset.revisionId)?.revisionApprovalState ?? null;
  const sealedCompositionCount = post.compositionReceipt?.length ?? 0;
  const hasVerifiedApproval = approvalState === "APPROVED" || sealedCompositionCount > 0;
  const hasFailure = post.status === "FAILED" || post.workerStatus === "FAILED" || Boolean(post.publishError);
  const needsVerification = post.status === "PRIVATE_ONLY_UNVERIFIED";
  const isPosted = post.status === "POSTED";
  const prepComplete = Boolean(post.title.trim() && post.caption.trim());

  let nextAction: string;
  let recovery: string | null = null;
  if (!hasVerifiedApproval) {
    nextAction = "Return this exact revision to pastor approval before any publishing handoff.";
    recovery = "The content is unapproved or changed after approval. Prepare a new revision, obtain approval, and run preflight again.";
  } else if (needsVerification) {
    nextAction = "Check the destination platform and confirm the post's actual visibility.";
    recovery = "Do not retry until a publisher confirms the first attempt is not live. Use the manual handoff if the result remains unclear.";
  } else if (hasFailure) {
    nextAction = "Check the destination platform before retrying this exact approved post.";
    recovery = "Keep the failure visible, verify that no duplicate post exists, then retry with the same idempotency identity or complete the manual handoff.";
  } else if (isPosted) {
    nextAction = "Keep the platform receipt with this post and hand performance follow-up to the communications team.";
  } else if (post.automationMode === "MANUAL") {
    nextAction = "Communications prepares the exact media and copy; the publisher verifies the platform preflight and uploads it manually.";
  } else {
    nextAction = "Publisher verifies account, audience, private visibility, and schedule, then explicitly confirms the exact approved payload.";
  }

  const approvalTrace = approvalRevision
    ? approvalState === "APPROVED"
      ? `Approved revision ${approvalRevision}`
      : `Revision ${approvalRevision} is ${readableStatus(approvalState ?? "not approved")} — handoff blocked`
    : sealedCompositionCount > 0
      ? `${sealedCompositionCount} sealed clip composition${sealedCompositionCount === 1 ? "" : "s"}`
      : "No approval receipt is visible here — automatic handoff must remain blocked";

  return {
    stages: [
      {
        label: "Pastor approval",
        responsibility: "Confirms the sermon meaning and exact message.",
        state: hasVerifiedApproval ? "COMPLETE" : "ATTENTION",
      },
      {
        label: "Communications preparation",
        responsibility: "Prepares final media, copy, platform, audience, and timing.",
        state: prepComplete ? "COMPLETE" : "CURRENT",
      },
      {
        label: "Publisher preflight",
        responsibility: "Checks the exact payload and records the platform result.",
        state: isPosted ? "COMPLETE" : hasFailure || needsVerification ? "ATTENTION" : "WAITING",
      },
    ],
    sourceTrace: post.contentAssets?.length
      ? post.contentAssets.map((asset) => asset.sermonTitle ? `${asset.sermonTitle} · ${asset.title}` : asset.title).join("; ")
      : `${post.clipIds.length} approved clip${post.clipIds.length === 1 ? "" : "s"} · scheduled post ${post.id}`,
    approvalTrace,
    owner: input.ownerLabel?.trim() || "Communications responsibility · person not assigned",
    assignee: input.assigneeLabel?.trim() || (post.workerId ? `Publishing worker ${post.workerId}` : "Not assigned"),
    destination: `${post.platform} · ${post.socialAccountLabel ?? "No connected account selected"}`,
    audience: "Confirm the intended audience in the destination platform before handoff",
    privacy: post.finalPrivacyStatus
      ? `Recorded platform result: ${readableStatus(post.finalPrivacyStatus)}`
      : post.automationMode === "MANUAL"
        ? "Private/manual by default; the publisher confirms visibility in the platform"
        : "No verified privacy result yet; the publisher must explicitly choose and confirm platform visibility",
    schedule: post.scheduledFor
      ? `${new Date(post.scheduledFor).toISOString()}${post.timezone ? ` · ${post.timezone}` : ""}`
      : "No exact publishing time set",
    nextAction,
    recovery,
  };
}

export function GovernedPublishingHandoff({
  post,
  ownerLabel,
  assigneeLabel,
}: {
  post: HandoffPost;
  ownerLabel?: string | null;
  assigneeLabel?: string | null;
}) {
  const model = buildGovernedPublishingHandoffModel({ post, ownerLabel, assigneeLabel });

  return (
    <details className={styles.handoff}>
      <summary>Approval &amp; publishing handoff</summary>
      <div className={styles.body}>
        <p className="small muted">
          These are workflow responsibilities, not claims about the signed-in person&apos;s role.
        </p>
        <ol className={styles.stages} aria-label="Governed publishing responsibilities">
          {model.stages.map((stage) => (
            <li key={stage.label} data-state={stage.state.toLowerCase()}>
              <strong>{stage.label}</strong>
              <span>{stage.responsibility}</span>
            </li>
          ))}
        </ol>
        <dl className={styles.preflight}>
          <div><dt>Source</dt><dd>{model.sourceTrace}</dd></div>
          <div><dt>Approval</dt><dd>{model.approvalTrace}</dd></div>
          <div><dt>Owner</dt><dd>{model.owner}</dd></div>
          <div><dt>Assignee</dt><dd>{model.assignee}</dd></div>
          <div><dt>Platform &amp; account</dt><dd>{model.destination}</dd></div>
          <div><dt>Audience</dt><dd>{model.audience}</dd></div>
          <div><dt>Privacy</dt><dd>{model.privacy}</dd></div>
          <div><dt>Schedule</dt><dd>{model.schedule}</dd></div>
        </dl>
        <div className={styles.nextAction}>
          <strong>Exact next action</strong>
          <p>{model.nextAction}</p>
          {model.recovery ? <p role="alert">Recovery: {model.recovery}</p> : null}
        </div>
        <p className="small muted">
          {post.automationMode === "MANUAL"
            ? "This is a private/manual handoff. This panel cannot call a provider or publish a post."
            : "This governance panel cannot call a provider. Existing automatic publishing stays separate and still requires its explicit confirmation and preflight."}
        </p>
      </div>
    </details>
  );
}
