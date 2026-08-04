export type YouTubeSourceFailureClassification = {
  code: "YOUTUBE_AUTH_REQUIRED" | "YOUTUBE_FORBIDDEN" | "VIDEO_DOWNLOAD_FAILED";
  retryable: boolean;
  uploadRecoveryRecommended: boolean;
};

const YOUTUBE_AUTH_FAILURE_PATTERNS = [
  "sign in to confirm you're not a bot",
  "sign in to confirm you’re not a bot",
  "use --cookies-from-browser or --cookies",
  "this helps protect our community",
  "authentication required",
  "login required",
];

export function looksLikeYouTubeAuthFailure(message: string): boolean {
  const normalized = message.toLowerCase();
  return YOUTUBE_AUTH_FAILURE_PATTERNS.some((pattern) => normalized.includes(pattern));
}

export function looksLikeYouTubeForbiddenFailure(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("http error 403") || normalized.includes("forbidden");
}

export function classifyYouTubeSourceFailure(message: string): YouTubeSourceFailureClassification {
  if (looksLikeYouTubeAuthFailure(message)) {
    return {
      code: "YOUTUBE_AUTH_REQUIRED",
      retryable: false,
      uploadRecoveryRecommended: true,
    };
  }

  if (looksLikeYouTubeForbiddenFailure(message)) {
    return {
      code: "YOUTUBE_FORBIDDEN",
      retryable: true,
      uploadRecoveryRecommended: true,
    };
  }

  return {
    code: "VIDEO_DOWNLOAD_FAILED",
    retryable: true,
    uploadRecoveryRecommended: true,
  };
}

export function shouldOfferYouTubeUploadRecovery(input: {
  failureCode?: string | null;
  message?: string | null;
}): boolean {
  if (
    input.failureCode === "YOUTUBE_AUTH_REQUIRED"
    || input.failureCode === "YOUTUBE_FORBIDDEN"
    || input.failureCode === "VIDEO_DOWNLOAD_FAILED"
  ) {
    return true;
  }

  const message = input.message ?? "";
  return looksLikeYouTubeAuthFailure(message) || looksLikeYouTubeForbiddenFailure(message);
}
