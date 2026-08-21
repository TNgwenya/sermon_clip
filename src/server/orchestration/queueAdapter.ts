import type { OrchestrationLane, OrchestrationQueueEnvelope } from "./contracts";

export type QueuePublishReceipt = {
  providerMessageId: string;
  acceptedAt: Date;
};

export type QueuePublishOptions = {
  /** A portable routing hint. An SQS adapter may map this to a queue URL. */
  lane: OrchestrationLane;
  /** Delay is advisory and must be bounded by the concrete adapter. */
  notBefore?: Date;
};

export interface OrchestrationQueueAdapter {
  readonly adapterName: string;
  publish(
    envelope: OrchestrationQueueEnvelope,
    options: QueuePublishOptions,
  ): Promise<QueuePublishReceipt>;
}

export class QueuePublishError extends Error {
  readonly retryable: boolean;
  readonly code: string;

  constructor(message: string, options: { retryable: boolean; code: string; cause?: unknown }) {
    super(message, { cause: options.cause });
    this.name = "QueuePublishError";
    this.retryable = options.retryable;
    this.code = options.code;
  }
}
