import type { OrchestrationQueueEnvelope } from "./contracts";
import type {
  OrchestrationQueueAdapter,
  QueuePublishOptions,
  QueuePublishReceipt,
} from "./queueAdapter";

/**
 * Portable zero-infrastructure adapter for pilots. The durable Postgres job is
 * the queue of record; publishing records that a database-polling worker can
 * see it. Replace this adapter with SQS (or another broker) without changing
 * job payloads, idempotency, leases, or stage handlers.
 */
export class DatabasePollingQueueAdapter implements OrchestrationQueueAdapter {
  readonly adapterName = "database-polling";
  readonly #now: () => Date;

  constructor(options: { now?: () => Date } = {}) {
    this.#now = options.now ?? (() => new Date());
  }

  async publish(
    envelope: OrchestrationQueueEnvelope,
    options: QueuePublishOptions,
  ): Promise<QueuePublishReceipt> {
    void options;
    return {
      providerMessageId: `database-polling:${envelope.messageKey}`,
      acceptedAt: this.#now(),
    };
  }
}
