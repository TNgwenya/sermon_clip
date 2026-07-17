export type PublishingReadinessInput = {
  mediaReady: boolean;
  qualityLabel: string | null;
  postReadyStatus: string | null;
  postReadyBlockers: string[];
};

export function isEditoriallyPostReady(clip: PublishingReadinessInput): boolean {
  if (!clip.mediaReady || clip.postReadyBlockers.length > 0) {
    return false;
  }

  if (clip.postReadyStatus) {
    return clip.postReadyStatus === "POST_READY";
  }

  return clip.qualityLabel === "POST_READY";
}
