type SocialMetricIdentityInput = {
  source: string;
  platform: string;
  socialAccountId?: string | null;
  externalAccountId?: string | null;
  platformPostId?: string | null;
  capturedAt: Date;
};

function normalize(value: string | null | undefined, fallback: string): string {
  const cleaned = value?.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "_");
  return cleaned || fallback;
}

export function socialMetricDedupeKey(input: SocialMetricIdentityInput): string {
  const captureDay = input.capturedAt.toISOString().slice(0, 10);
  return [
    normalize(input.source, "unknown_source"),
    normalize(input.platform, "unknown_platform"),
    normalize(input.socialAccountId ?? input.externalAccountId, "unscoped_account"),
    normalize(input.platformPostId, "account_daily_total"),
    captureDay,
  ].join(":");
}
