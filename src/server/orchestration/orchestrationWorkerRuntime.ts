import type { OrchestrationJobRecord, PortableJsonValue } from "./contracts";
import type { LeaseIdentity } from "./schedulingRecovery";
import type { SermonLaneExecutionResult } from "./sermonLaneExecutor";
import type { SermonWorkflowPayloadV1 } from "./sermonWorkflow";
import { nextAutomaticJob } from "./sermonWorkflow";

export type OrchestrationWorkerStore = {
  completeAndEnqueueFollowOn(input: {
    organizationId: string;
    jobId: string;
    lease: LeaseIdentity;
    followOn?: {
      sermonId?: string | null;
      lane: OrchestrationJobRecord["lane"];
      logicalKey: string;
      payload: PortableJsonValue;
      priority: number;
      maxAttempts: number;
    } | null;
  }): Promise<unknown>;
  acknowledgeCancel(input: {
    organizationId: string;
    jobId: string;
    lease: LeaseIdentity;
  }): Promise<unknown>;
  fail(input: {
    organizationId: string;
    jobId: string;
    lease: LeaseIdentity;
    failureCode: string;
    failureMessage: string;
    retryAfterMs?: number | null;
  }): Promise<unknown>;
};

function failureCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = String((error as { code?: unknown }).code ?? "").trim();
    if (code) return code;
  }
  return "UNKNOWN";
}

function failureMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error ?? "Unknown orchestration error.")).slice(0, 4_000);
}

export async function runClaimedOrchestrationJob(input: {
  job: OrchestrationJobRecord;
  lease: LeaseIdentity;
  store: OrchestrationWorkerStore;
  execute: (input: {
    lane: OrchestrationJobRecord["lane"];
    payload: unknown;
  }) => Promise<SermonLaneExecutionResult>;
}): Promise<"SUCCEEDED" | "CANCELLED" | "FAILED_OR_RETRYING"> {
  try {
    const result = await input.execute({ lane: input.job.lane, payload: input.job.payloadJson });
    const followOn = nextAutomaticJob(
      result.completion,
      input.job.payloadJson as unknown as SermonWorkflowPayloadV1,
    );
    await input.store.completeAndEnqueueFollowOn({
      organizationId: input.job.organizationId,
      jobId: input.job.id,
      lease: input.lease,
      followOn: followOn ? { ...followOn, sermonId: input.job.sermonId } : null,
    });
    return "SUCCEEDED";
  } catch (error) {
    if (failureCode(error) === "CANCELLATION_REQUESTED") {
      await input.store.acknowledgeCancel({
        organizationId: input.job.organizationId,
        jobId: input.job.id,
        lease: input.lease,
      });
      return "CANCELLED";
    }
    await input.store.fail({
      organizationId: input.job.organizationId,
      jobId: input.job.id,
      lease: input.lease,
      failureCode: failureCode(error),
      failureMessage: failureMessage(error),
    });
    return "FAILED_OR_RETRYING";
  }
}

export const __orchestrationWorkerRuntimeTestUtils = { failureCode, failureMessage };
