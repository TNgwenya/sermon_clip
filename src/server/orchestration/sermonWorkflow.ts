import type { OrchestrationLane, PortableJsonValue } from "./contracts";

export const EARLY_VALUE_PREVIEW_LIMIT = 3;

export type SermonWorkflowPayloadV1 = {
  kind: "SERMON_WORKFLOW";
  sermonId: string;
  sourceRevision: string;
  force: boolean;
  previewLimit: number;
  requireBrandedFirstPreview: boolean;
};

export type FollowOnJob = {
  lane: OrchestrationLane;
  logicalKey: string;
  payload: PortableJsonValue;
  priority: number;
  maxAttempts: number;
};

export type LaneCompletion = {
  lane: OrchestrationLane;
  suggestionsReady?: boolean;
  firstBrandedPreviewReady?: boolean;
  requestedContentWeek?: boolean;
};

const EARLY_VALUE_PRIORITY = 100;
const DEFERRED_PRIORITY = 10;

function requireValue(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} is required.`);
  return normalized;
}

export function buildSermonWorkflowPayload(input: {
  sermonId: string;
  sourceRevision: string;
  force?: boolean;
}): SermonWorkflowPayloadV1 {
  return {
    kind: "SERMON_WORKFLOW",
    sermonId: requireValue(input.sermonId, "sermonId"),
    sourceRevision: requireValue(input.sourceRevision, "sourceRevision"),
    force: input.force === true,
    previewLimit: EARLY_VALUE_PREVIEW_LIMIT,
    requireBrandedFirstPreview: true,
  };
}

export function workflowLogicalKey(
  lane: OrchestrationLane,
  payload: SermonWorkflowPayloadV1,
): string {
  const revision = requireValue(payload.sourceRevision, "sourceRevision");
  return `sermon-workflow:v1:${lane.toLowerCase()}:${revision}`;
}

/**
 * Defines only automatic continuation. Export and publishing never appear
 * here: they require the existing human approval and explicit publish intent.
 * Content Week is also deferred until explicitly requested so previews win
 * scarce media/AI capacity during first use.
 */
export function nextAutomaticJob(
  completion: LaneCompletion,
  payload: SermonWorkflowPayloadV1,
): FollowOnJob | null {
  let lane: OrchestrationLane | null = null;

  switch (completion.lane) {
    case "INTAKE_MATERIALIZATION":
      lane = "TRANSCRIPTION";
      break;
    case "TRANSCRIPTION":
      lane = "INTELLIGENCE";
      break;
    case "INTELLIGENCE":
      if (completion.suggestionsReady !== true) {
        throw new Error("Intelligence cannot continue to preview until suggestions are durably ready.");
      }
      lane = "PREVIEW";
      break;
    case "PREVIEW":
      if (payload.requireBrandedFirstPreview && completion.firstBrandedPreviewReady !== true) {
        throw new Error("The priority preview lane cannot complete before a branded review preview is ready.");
      }
      return null;
    case "CONTENT_WEEK":
    case "FINAL_RENDER_EXPORT":
    case "PUBLISHING":
      return null;
  }

  return {
    lane,
    logicalKey: workflowLogicalKey(lane, payload),
    payload: payload as unknown as PortableJsonValue,
    priority: EARLY_VALUE_PRIORITY,
    maxAttempts: lane === "TRANSCRIPTION" ? 4 : 3,
  };
}

export function buildOnDemandJob(input: {
  lane: "CONTENT_WEEK" | "FINAL_RENDER_EXPORT" | "PUBLISHING";
  payload: SermonWorkflowPayloadV1;
  approvalReference?: string;
  publishIntentReference?: string;
}): FollowOnJob {
  if (input.lane === "FINAL_RENDER_EXPORT") {
    requireValue(input.approvalReference ?? "", "approvalReference");
  }
  if (input.lane === "PUBLISHING") {
    requireValue(input.approvalReference ?? "", "approvalReference");
    requireValue(input.publishIntentReference ?? "", "publishIntentReference");
  }

  const intentSuffix = input.lane === "CONTENT_WEEK"
    ? "requested"
    : `${input.approvalReference}:${input.publishIntentReference ?? "export"}`;

  return {
    lane: input.lane,
    logicalKey: `${workflowLogicalKey(input.lane, input.payload)}:${intentSuffix}`,
    payload: {
      ...input.payload,
      approvalReference: input.approvalReference ?? null,
      publishIntentReference: input.publishIntentReference ?? null,
    } as PortableJsonValue,
    priority: input.lane === "CONTENT_WEEK" ? DEFERRED_PRIORITY : EARLY_VALUE_PRIORITY,
    maxAttempts: input.lane === "PUBLISHING" ? 3 : 2,
  };
}

export const SERMON_WORKFLOW_SERVICE_SEMANTICS = {
  firstSuggestions: "INTELLIGENCE",
  firstBrandedPreview: "PREVIEW",
  fullContent: "CONTENT_WEEK",
  automaticLanes: [
    "INTAKE_MATERIALIZATION",
    "TRANSCRIPTION",
    "INTELLIGENCE",
    "PREVIEW",
  ] as const,
  approvalGatedLanes: ["FINAL_RENDER_EXPORT", "PUBLISHING"] as const,
};
