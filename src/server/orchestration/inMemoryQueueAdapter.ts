import { randomUUID } from "node:crypto";

import type { OrchestrationQueueEnvelope } from "./contracts";
import type {
  OrchestrationQueueAdapter,
  QueuePublishOptions,
  QueuePublishReceipt,
} from "./queueAdapter";

export type InMemoryQueueMessage = {
  envelope: OrchestrationQueueEnvelope;
  options: QueuePublishOptions;
  receipt: QueuePublishReceipt;
};

export class InMemoryOrchestrationQueueAdapter implements OrchestrationQueueAdapter {
  readonly adapterName = "in-memory";
  readonly #messages: InMemoryQueueMessage[] = [];
  readonly #receiptByMessageKey = new Map<string, QueuePublishReceipt>();
  readonly #now: () => Date;

  constructor(options: { now?: () => Date } = {}) {
    this.#now = options.now ?? (() => new Date());
  }

  async publish(
    envelope: OrchestrationQueueEnvelope,
    options: QueuePublishOptions,
  ): Promise<QueuePublishReceipt> {
    const existing = this.#receiptByMessageKey.get(envelope.messageKey);
    if (existing) return existing;

    const receipt = {
      providerMessageId: `memory:${randomUUID()}`,
      acceptedAt: this.#now(),
    };
    this.#receiptByMessageKey.set(envelope.messageKey, receipt);
    this.#messages.push({
      envelope: structuredClone(envelope),
      options: { ...options },
      receipt: { ...receipt },
    });
    return receipt;
  }

  messages(): readonly InMemoryQueueMessage[] {
    return structuredClone(this.#messages);
  }

  takeNext(lane?: OrchestrationQueueEnvelope["lane"]): InMemoryQueueMessage | null {
    const index = this.#messages.findIndex((message) => !lane || message.envelope.lane === lane);
    if (index < 0) return null;
    return this.#messages.splice(index, 1)[0] ?? null;
  }

  clear(): void {
    this.#messages.length = 0;
    this.#receiptByMessageKey.clear();
  }
}
