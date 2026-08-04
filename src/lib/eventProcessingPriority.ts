export type EventAwareProcessingCandidate = {
  id: string;
  createdAt: Date;
  sermon?: {
    eventSession?: {
      priority: number;
      scheduledStartAt: Date;
      status: string;
      event: { status: string };
    } | null;
  } | null;
};

function eventQueueScore(candidate: EventAwareProcessingCandidate): number {
  const session = candidate.sermon?.eventSession;
  if (!session || session.status === "CANCELLED" || session.event.status === "ARCHIVED") {
    return 0;
  }
  const eventBoost = session.event.status === "ACTIVE"
    ? 1_000
    : session.event.status === "UPCOMING"
      ? 500
      : session.event.status === "DRAFT"
        ? 200
        : 0;
  return eventBoost + Math.max(0, Math.min(100, session.priority));
}

export function sortEventAwareProcessingCandidates<T extends EventAwareProcessingCandidate>(
  candidates: T[],
): T[] {
  return candidates.sort((left, right) => {
    const scoreDifference = eventQueueScore(right) - eventQueueScore(left);
    if (scoreDifference !== 0) return scoreDifference;

    const leftSessionAt = left.sermon?.eventSession?.scheduledStartAt?.getTime();
    const rightSessionAt = right.sermon?.eventSession?.scheduledStartAt?.getTime();
    if (leftSessionAt !== undefined && rightSessionAt !== undefined && leftSessionAt !== rightSessionAt) {
      return leftSessionAt - rightSessionAt;
    }
    return left.createdAt.getTime() - right.createdAt.getTime();
  });
}
