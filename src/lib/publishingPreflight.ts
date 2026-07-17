import type { PostingAutomationMode, PostingPlatform } from "@/lib/postingDrafts";

export type PublishingPreflightStatus = "PASS" | "WARNING" | "BLOCKED";

export type PublishingPreflightCheck = {
  id: string;
  label: string;
  status: PublishingPreflightStatus;
  summary: string;
  platform?: PostingPlatform;
  clipId?: string;
};

export type PublishingPreflightPacket = {
  canSchedule: boolean;
  automationMode: PostingAutomationMode;
  platforms: PostingPlatform[];
  checks: PublishingPreflightCheck[];
  blockerCount: number;
  warningCount: number;
  checkedAt: string;
};

export type PublishingPreflightAccount = {
  id: string;
  platform: PostingPlatform;
  status: "CONNECTED" | "NEEDS_REVIEW";
  externalProvider: string | null;
  externalAccountId: string | null;
  externalPlatform: string | null;
  credentialReady: boolean;
  credentialIssue?: string | null;
};

export type PublishingPreflightClip = {
  id: string;
  title: string;
  durationSeconds: number;
  exportFormat: string | null;
  mediaReady: boolean;
  outputPath: string | null;
  transcriptReviewRequired: boolean;
};

export type PublishingServerCapabilities = {
  zernioConfigured: boolean;
  youtubeConfigured: boolean;
  youtubeOAuthClientConfigured: boolean;
  facebookConfigured: boolean;
  youtubePrivacy: string;
  youtubeApiVerified: boolean;
  facebookPublishesImmediately: boolean;
  tiktokProviderMode: "direct" | "zernio" | "account";
  tiktokDirectEnabled: boolean;
  tiktokDirectConfigured: boolean;
  tiktokOAuthClientConfigured: boolean;
  tiktokDirectPrivacy: string;
  tiktokZernioPrivacy: string | null;
  tiktokPrivacy: string | null;
};

export type PublishingServicePreflightHealth = {
  status: "ONLINE" | "STALE" | "NOT_SEEN";
  dryRun: boolean;
};

function makeCheck(
  id: string,
  label: string,
  status: PublishingPreflightStatus,
  summary: string,
  context: Pick<PublishingPreflightCheck, "platform" | "clipId"> = {},
): PublishingPreflightCheck {
  return { id, label, status, summary, ...context };
}

function selectedAccountsForPlatform(input: {
  platform: PostingPlatform;
  accounts: PublishingPreflightAccount[];
  selectedAccountIdsByPlatform?: Partial<Record<PostingPlatform, string[]>>;
}): PublishingPreflightAccount[] {
  const selectedIds = new Set(input.selectedAccountIdsByPlatform?.[input.platform] ?? []);
  const available = input.accounts.filter((account) => (
    account.platform === input.platform && account.status === "CONNECTED"
  ));

  return selectedIds.size > 0
    ? available.filter((account) => selectedIds.has(account.id))
    : available;
}

function validZernioAccount(
  account: PublishingPreflightAccount,
  platform: PostingPlatform,
): boolean {
  return account.externalProvider === "zernio"
    && Boolean(account.externalAccountId)
    && account.externalPlatform?.toLowerCase() === platform.toLowerCase();
}

function resolveTikTokProvider(input: {
  capabilities: PublishingServerCapabilities;
  accounts: PublishingPreflightAccount[];
}): "direct" | "zernio" {
  if (input.accounts.length > 0) {
    return input.accounts.some((account) => validZernioAccount(account, "TikTok"))
      ? "zernio"
      : "direct";
  }
  return input.capabilities.tiktokProviderMode === "zernio" ? "zernio" : "direct";
}

function buildConnectionChecks(input: {
  automationMode: PostingAutomationMode;
  platforms: PostingPlatform[];
  accounts: PublishingPreflightAccount[];
  selectedAccountIdsByPlatform?: Partial<Record<PostingPlatform, string[]>>;
  capabilities: PublishingServerCapabilities;
}): PublishingPreflightCheck[] {
  return input.platforms.flatMap((platform) => {
    if (input.automationMode === "MANUAL") {
      return [makeCheck(
        `connection:${platform}`,
        `${platform} handoff`,
        "PASS",
        "No connected account is required for a manual upload.",
        { platform },
      )];
    }

    const accounts = selectedAccountsForPlatform({
      platform,
      accounts: input.accounts,
      selectedAccountIdsByPlatform: input.selectedAccountIdsByPlatform,
    });
    const selectedAccountIds = new Set(input.selectedAccountIdsByPlatform?.[platform] ?? []);
    const hasExplicitAccountSelection = selectedAccountIds.size > 0;
    if (hasExplicitAccountSelection && accounts.length !== selectedAccountIds.size) {
      return [makeCheck(
        `connection:${platform}`,
        `${platform} publishing connection`,
        "BLOCKED",
        `One or more selected ${platform} accounts are unavailable or need reconnection.`,
        { platform },
      )];
    }
    const zernioAccounts = accounts.filter((account) => validZernioAccount(account, platform));
    const credentialAccounts = accounts.filter((account) => account.credentialReady);

    if (platform === "TikTok") {
      const directAccounts = accounts.filter((account) => !validZernioAccount(account, platform));
      if (zernioAccounts.length > 0 && directAccounts.length > 0) {
        return [makeCheck(
          `connection:${platform}`,
          "TikTok publishing connection",
          "BLOCKED",
          "Choose either one direct TikTok account or one Zernio TikTok account per automatic draft.",
          { platform },
        )];
      }
      const provider = resolveTikTokProvider({ capabilities: input.capabilities, accounts });
      const storedDirectReady = directAccounts.length > 0
        && directAccounts.every((account) => account.credentialReady)
        && input.capabilities.tiktokOAuthClientConfigured
        && input.capabilities.tiktokDirectEnabled;
      const directReady = hasExplicitAccountSelection
        ? storedDirectReady
        : storedDirectReady || (
            input.capabilities.tiktokDirectEnabled
            && input.capabilities.tiktokDirectConfigured
          );
      const ready = provider === "zernio"
        ? zernioAccounts.length > 0
          && zernioAccounts.length === accounts.length
          && input.capabilities.zernioConfigured
        : directReady;
      const credentialIssue = directAccounts.find((account) => !account.credentialReady)?.credentialIssue;
      const summary = provider === "zernio"
        ? ready
          ? "The selected Zernio TikTok channel and publishing service are ready."
          : "Connect and sync a Zernio TikTok channel before automatic publishing."
        : ready
          ? storedDirectReady
            ? "The selected TikTok OAuth account and worker OAuth client are ready for direct posting."
            : "The worker's direct TikTok publisher is configured."
          : credentialIssue
            ? credentialIssue
            : !input.capabilities.tiktokDirectEnabled
              ? "Direct TikTok posting is disabled until the required creator-info, privacy, disclosure, and consent review is implemented. Use Zernio or a manual handoff."
            : directAccounts.length > 0
              ? "The selected TikTok account is missing a valid video.publish credential or the worker OAuth client configuration."
            : "Connect TikTok directly or configure the worker's direct TikTok publisher.";
      return [makeCheck(
        `connection:${platform}`,
        "TikTok publishing connection",
        ready ? "PASS" : "BLOCKED",
        summary,
        { platform },
      )];
    }

    if (platform === "Instagram") {
      const ready = zernioAccounts.length > 0
        && (!hasExplicitAccountSelection || zernioAccounts.length === accounts.length)
        && input.capabilities.zernioConfigured;
      return [makeCheck(
        `connection:${platform}`,
        `${platform} publishing connection`,
        ready ? "PASS" : "BLOCKED",
        ready
          ? "A connected Zernio channel and publishing service are ready."
          : `Connect and sync a Zernio ${platform} channel before automatic publishing.`,
        { platform },
      )];
    }

    if (platform === "YouTube Shorts") {
      const storedCredentialReady = credentialAccounts.length > 0
        && (!hasExplicitAccountSelection || credentialAccounts.length === accounts.length)
        && input.capabilities.youtubeOAuthClientConfigured;
      const ready = storedCredentialReady || (!hasExplicitAccountSelection && input.capabilities.youtubeConfigured);
      return [makeCheck(
        `connection:${platform}`,
        "YouTube publishing connection",
        ready ? "PASS" : "BLOCKED",
        ready
          ? storedCredentialReady ? "A connected YouTube OAuth credential and worker OAuth client are ready." : "The server-managed YouTube OAuth publisher is configured."
          : accounts.length > 0
            ? "The connected YouTube channel is missing the worker OAuth client configuration."
            : "Connect YouTube or configure the server-managed YouTube publisher before automatic publishing.",
        { platform },
      )];
    }

    const storedCredentialReady = credentialAccounts.length > 0
      && (!hasExplicitAccountSelection || credentialAccounts.length === accounts.length);
    const ready = storedCredentialReady || (!hasExplicitAccountSelection && input.capabilities.facebookConfigured);
    return [makeCheck(
      `connection:${platform}`,
      "Facebook publishing connection",
      ready ? "PASS" : "BLOCKED",
      ready
        ? storedCredentialReady ? "The selected Meta Facebook Page credential is ready." : "The server-managed Meta Facebook publisher is configured."
        : "Connect a Facebook Page or configure the server-managed Facebook publisher before automatic publishing.",
      { platform },
    )];
  });
}

function buildClipChecks(input: {
  automationMode: PostingAutomationMode;
  platforms: PostingPlatform[];
  clips: PublishingPreflightClip[];
}): PublishingPreflightCheck[] {
  return input.clips.flatMap((clip) => {
    const checks: PublishingPreflightCheck[] = [
      makeCheck(
        `media:${clip.id}`,
        `${clip.title} media`,
        clip.mediaReady ? "PASS" : "BLOCKED",
        clip.mediaReady ? "The prepared video file is available." : "Rebuild the posting media before scheduling.",
        { clipId: clip.id },
      ),
      makeCheck(
        `transcript:${clip.id}`,
        `${clip.title} transcript`,
        clip.transcriptReviewRequired ? "BLOCKED" : "PASS",
        clip.transcriptReviewRequired
          ? "Confirm the sermon wording before publishing this clip."
          : "The transcript review gate is clear.",
        { clipId: clip.id },
      ),
    ];

    const extension = clip.outputPath?.split("?")[0]?.split(".").pop()?.toLowerCase();
    checks.push(makeCheck(
      `format:${clip.id}`,
      `${clip.title} file format`,
      extension === "mp4" ? "PASS" : extension ? "BLOCKED" : "WARNING",
      extension === "mp4"
        ? "MP4 video is ready for the selected platforms."
        : extension
          ? `The prepared file is ${extension.toUpperCase()}; rebuild it as MP4 before automatic publishing.`
          : "The prepared file format could not be confirmed from its metadata.",
      { clipId: clip.id },
    ));

    for (const platform of input.platforms) {
      const expectsVertical = platform !== "Facebook";
      const vertical = clip.exportFormat === "VERTICAL_9_16";
      checks.push(makeCheck(
        `aspect:${clip.id}:${platform}`,
        `${platform} framing`,
        !expectsVertical || vertical ? "PASS" : "WARNING",
        !expectsVertical
          ? "Facebook accepts the prepared framing."
          : vertical
            ? "The clip uses the recommended 9:16 vertical format."
            : "This clip is not marked as 9:16 vertical; confirm the platform preview before publishing.",
        { clipId: clip.id, platform },
      ));

      const instagramBlocked = input.automationMode === "AUTOMATIC"
        && platform === "Instagram"
        && clip.durationSeconds > 60;
      const youtubeWarning = platform === "YouTube Shorts" && clip.durationSeconds > 180;
      checks.push(makeCheck(
        `duration:${clip.id}:${platform}`,
        `${platform} duration`,
        instagramBlocked ? "BLOCKED" : youtubeWarning ? "WARNING" : "PASS",
        instagramBlocked
          ? "Instagram automatic publishing currently supports clips up to 60 seconds."
          : youtubeWarning
            ? "This video is longer than 180 seconds and may not be classified as a Short."
            : `${Math.round(clip.durationSeconds)} seconds is within the current ${platform} workflow limit.`,
        { clipId: clip.id, platform },
      ));
    }

    return checks;
  });
}

function buildPrivacyChecks(input: {
  automationMode: PostingAutomationMode;
  platforms: PostingPlatform[];
  accounts: PublishingPreflightAccount[];
  selectedAccountIdsByPlatform?: Partial<Record<PostingPlatform, string[]>>;
  capabilities: PublishingServerCapabilities;
}): PublishingPreflightCheck[] {
  return input.platforms.map((platform) => {
    if (input.automationMode === "MANUAL") {
      return makeCheck(
        `privacy:${platform}`,
        `${platform} privacy`,
        "PASS",
        "Your media team will confirm visibility in the platform before publishing.",
        { platform },
      );
    }

    if (platform === "YouTube Shorts") {
      const privacy = input.capabilities.youtubeApiVerified
        ? input.capabilities.youtubePrivacy
        : "private";
      return makeCheck(
        `privacy:${platform}`,
        "YouTube visibility",
        privacy === "public" ? "PASS" : "WARNING",
        input.capabilities.youtubeApiVerified
          ? `The upload will use ${privacy} visibility.`
          : "The upload will remain private until the YouTube API project is verified.",
        { platform },
      );
    }

    if (platform === "Facebook") {
      return makeCheck(
        `privacy:${platform}`,
        "Facebook visibility",
        "WARNING",
        input.capabilities.facebookPublishesImmediately
          ? "Facebook will be asked to publish immediately; confirm the Page result before Sermon Clip records it as live."
          : "The Facebook Page video will upload as unpublished for a final visibility check.",
        { platform },
      );
    }

    if (platform === "TikTok") {
      const accounts = selectedAccountsForPlatform({
        platform,
        accounts: input.accounts,
        selectedAccountIdsByPlatform: input.selectedAccountIdsByPlatform,
      });
      const provider = resolveTikTokProvider({ capabilities: input.capabilities, accounts });
      const privacy = provider === "zernio"
        ? input.capabilities.tiktokZernioPrivacy
        : input.capabilities.tiktokDirectPrivacy;
      const publiclyVisible = privacy?.toUpperCase().includes("PUBLIC") === true;
      return makeCheck(
        `privacy:${platform}`,
        "TikTok visibility",
        publiclyVisible ? "PASS" : "WARNING",
        privacy
          ? `The ${provider === "zernio" ? "Zernio" : "direct TikTok"} publisher will request ${privacy} visibility.`
          : `${provider === "zernio" ? "Zernio" : "Direct TikTok"} visibility is not explicit; confirm it after publishing.`,
        { platform },
      );
    }

    return makeCheck(
      `privacy:${platform}`,
      "Instagram visibility",
      "WARNING",
      "Instagram visibility follows the connected provider's channel settings; confirm it after publishing.",
      { platform },
    );
  });
}

function buildPublishingServiceCheck(input: {
  automationMode: PostingAutomationMode;
  serviceHealth: PublishingServicePreflightHealth;
}): PublishingPreflightCheck {
  if (input.automationMode === "MANUAL") {
    return makeCheck(
      "publishing-service",
      "Publishing service",
      "PASS",
      "Manual upload does not require the automatic publishing service.",
    );
  }

  if (input.serviceHealth.status !== "ONLINE") {
    return makeCheck(
      "publishing-service",
      "Automatic publishing service",
      "BLOCKED",
      input.serviceHealth.status === "STALE"
        ? "The publishing service has not checked in recently. Restart it before scheduling automatic posts."
        : "Start the publishing service and wait for its first check-in before scheduling automatic posts.",
    );
  }

  if (input.serviceHealth.dryRun) {
    return makeCheck(
      "publishing-service",
      "Automatic publishing service",
      "BLOCKED",
      "The publishing service is in test mode and will not send posts live. Switch it to live mode before scheduling.",
    );
  }

  return makeCheck(
    "publishing-service",
    "Automatic publishing service",
    "PASS",
    "The publishing service is online in live mode.",
  );
}

export function buildPublishingPreflight(input: {
  automationMode: PostingAutomationMode;
  platforms: PostingPlatform[];
  clips: PublishingPreflightClip[];
  accounts: PublishingPreflightAccount[];
  selectedAccountIdsByPlatform?: Partial<Record<PostingPlatform, string[]>>;
  capabilities: PublishingServerCapabilities;
  serviceHealth: PublishingServicePreflightHealth;
  checkedAt?: Date;
}): PublishingPreflightPacket {
  const checks = [
    buildPublishingServiceCheck(input),
    ...buildConnectionChecks(input),
    ...buildClipChecks(input),
    ...buildPrivacyChecks(input),
  ];
  const blockerCount = checks.filter((check) => check.status === "BLOCKED").length;
  const warningCount = checks.filter((check) => check.status === "WARNING").length;

  return {
    canSchedule: blockerCount === 0,
    automationMode: input.automationMode,
    platforms: input.platforms,
    checks,
    blockerCount,
    warningCount,
    checkedAt: (input.checkedAt ?? new Date()).toISOString(),
  };
}
