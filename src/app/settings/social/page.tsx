import Link from "next/link";
import { headers } from "next/headers";

import { SectionCard, StatusBadge } from "@/components/ui";
import {
  buildOAuthRedirectUri,
  buildRequestBaseUrl,
  listSocialAnalyticsConnectors,
} from "@/lib/socialAnalyticsConnectors";

export const dynamic = "force-dynamic";

type SearchParams = {
  oauth?: string;
  provider?: string;
  reason?: string;
  accounts?: string;
};

function statusTone(status: string): "success" | "warning" | "neutral" {
  if (status === "ready") return "success";
  if (status === "planned" || status === "needs_setup") return "warning";
  return "neutral";
}

function setupStatusLabel(status: string): string {
  if (status === "ready") return "Connected";
  if (status === "needs_setup") return "Developer setup required";
  if (status === "manual") return "Manual tracking";
  return status.replace(/_/g, " ");
}

function providerLabel(provider: string | undefined): string {
  if (provider === "meta") return "Meta";
  if (provider === "youtube") return "YouTube";
  if (provider === "tiktok") return "TikTok";
  if (provider === "threads") return "Threads";
  return provider ?? "Provider";
}

function oauthFailureMessage(provider: string | undefined, reason: string | undefined): string {
  const label = providerLabel(provider);

  switch (reason) {
    case "missing_server_oauth_env":
      return `${label} OAuth reached this app, but this server is missing the provider app credentials. Add them to the environment for the app handling the callback, then restart or redeploy.`;
    case "redirect_uri_mismatch":
      return `${label} rejected the callback URL. Add the exact Redirect URI shown below to the provider app settings, then try again.`;
    case "invalid_client":
      return `${label} rejected the app id or secret. Check the provider credentials in this server environment.`;
    case "invalid_grant":
      return `${label} rejected the one-time authorization code. Start Connect again after confirming the callback URL matches exactly.`;
    case "missing_or_unapproved_permission":
      return `${label} connected, but the requested permission is missing or not approved for this account/app. Check provider app review and account roles.`;
    case "no_facebook_pages_found":
      return "Meta authorized your login, but did not return any Facebook Pages. Make sure the Facebook user manages the Page and grants Page access during login.";
    case "provider_network_failed":
      return `${label} could not be reached from this server during token exchange. Try again, or check server network access.`;
    case "oauth_exchange_failed":
      return `${label} OAuth token exchange failed. Check the server log for the provider error, then retry Connect.`;
    case "invalid_oauth_state":
      return `${label} connection expired or could not be verified. Start Connect again from this page.`;
    default:
      return `${label} OAuth failed: ${reason ?? "unknown error"}.`;
  }
}

function platformStatus(input: { authHref: string | null; connectedAccounts?: number; missingEnv?: string[] }): {
  label: string;
  tone: "success" | "warning" | "neutral";
  priority: number;
} {
  if ((input.connectedAccounts ?? 0) > 0) {
    return { label: "Connected", tone: "success", priority: 1 };
  }

  if (input.authHref) {
    return { label: "Ready to connect", tone: "success", priority: 0 };
  }

  if ((input.missingEnv ?? []).length > 0) {
    return { label: "App credentials missing", tone: "warning", priority: 2 };
  }

  return { label: "Setup needed", tone: "warning", priority: 2 };
}

function oauthBanner(params: SearchParams): { tone: "success" | "warning"; title: string; message: string } | null {
  if (params.oauth === "connected") {
    const accountCount = params.accounts ? ` ${params.accounts} account${params.accounts === "1" ? "" : "s"} connected.` : "";
    return {
      tone: "success",
      title: "Connector authorized",
      message: `${params.provider ?? "Provider"} OAuth completed successfully.${accountCount}`,
    };
  }

  if (params.oauth === "failed") {
    return {
      tone: "warning",
      title: "Connector not authorized",
      message: oauthFailureMessage(params.provider, params.reason),
    };
  }

  return null;
}

export default async function SocialSettingsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const requestBaseUrl = buildRequestBaseUrl(await headers());
  const redirectUris = {
    youtube: buildOAuthRedirectUri("youtube", requestBaseUrl),
    meta: buildOAuthRedirectUri("meta", requestBaseUrl),
    tiktok: buildOAuthRedirectUri("tiktok", requestBaseUrl),
    threads: buildOAuthRedirectUri("threads", requestBaseUrl),
  };
  const connectors = await listSocialAnalyticsConnectors();
  const youtubeClientId = process.env.YOUTUBE_CLIENT_ID?.trim();
  const metaAppId = process.env.META_APP_ID?.trim();
  const tiktokClientKey = process.env.TIKTOK_CLIENT_KEY?.trim();
  const threadsAppId = process.env.THREADS_APP_ID?.trim();
  const youtubeAuthHref = youtubeClientId && process.env.YOUTUBE_CLIENT_SECRET?.trim()
    ? "/api/oauth/youtube/start"
    : null;
  const metaAuthHref = metaAppId && process.env.META_APP_SECRET?.trim()
    ? "/api/oauth/meta/start"
    : null;
  const tiktokAuthHref = tiktokClientKey && process.env.TIKTOK_CLIENT_SECRET?.trim()
    ? "/api/oauth/tiktok/start"
    : null;
  const threadsAuthHref = threadsAppId && process.env.THREADS_APP_SECRET?.trim()
    ? "/api/oauth/threads/start"
    : null;
  const banner = oauthBanner(params);
  const connectorByPlatform = new Map(connectors.map((connector) => [connector.platform, connector]));
  const connectionCards = [
    {
      platform: "YouTube",
      provider: "youtube" as const,
      authHref: youtubeAuthHref,
      actionLabel: "Connect YouTube",
      description: "Use YouTube analytics and approved Shorts uploads.",
      setupDescription: "Uses analytics, readonly channel identity, and YouTube upload scopes.",
      connector: connectorByPlatform.get("YouTube"),
    },
    {
      platform: "Instagram / Facebook",
      provider: "meta" as const,
      authHref: metaAuthHref,
      actionLabel: "Connect Meta",
      description: "Use Meta Pages, Instagram business insights, and approved posting.",
      setupDescription: "Uses Meta Pages, posting, and Instagram business insights permissions.",
      connector: connectorByPlatform.get("Instagram / Facebook"),
    },
    {
      platform: "TikTok",
      provider: "tiktok" as const,
      authHref: tiktokAuthHref,
      actionLabel: "Connect TikTok",
      description: "Use TikTok publishing and analytics when app review allows.",
      setupDescription: "Uses basic profile plus video publishing/list scopes where TikTok app review allows.",
      connector: connectorByPlatform.get("TikTok"),
    },
    {
      platform: "Threads",
      provider: "threads" as const,
      authHref: threadsAuthHref,
      actionLabel: "Connect Threads",
      description: "Use Threads profile and insights data.",
      setupDescription: "Uses Threads basic profile and insights scopes.",
      connector: connectorByPlatform.get("Threads"),
    },
  ]
    .map((card) => ({
      ...card,
      status: platformStatus({
        authHref: card.authHref,
        connectedAccounts: card.connector?.connectedAccounts,
        missingEnv: card.connector?.missingEnv,
      }),
    }))
    .sort((a, b) => a.status.priority - b.status.priority || a.platform.localeCompare(b.platform));

  return (
    <main className="growth-page-shell stack-lg">
      <header className="growth-hero">
        <div className="stack-sm">
          <p className="kicker">Social settings</p>
          <h1>Social connections.</h1>
          <p className="muted">Connect church accounts for analytics, scheduling, and approved posting.</p>
        </div>
        <nav className="topbar-actions">
          <Link href="/growth" className="button secondary">Back to growth</Link>
        </nav>
      </header>

      {banner ? (
        <div className={banner.tone === "success" ? "success-banner" : "error-banner"}>
          <strong>{banner.title}</strong>
          <span>{banner.message}</span>
        </div>
      ) : null}

      <SectionCard title="Account connections" description="Connect each platform once. Sermon Clip stores account access securely for analytics sync and approved publishing.">
        <div className="growth-connector-list social-connection-list">
          {connectionCards.map((card) => (
            <article key={card.platform} className="growth-connector-row social-connector-card">
              <div className="social-connector-main">
                <div className="social-connector-heading">
                  <strong>{card.platform}</strong>
                  <StatusBadge tone={card.status.tone}>{card.status.label}</StatusBadge>
                </div>
                <p className="muted small">{card.description}</p>
                {typeof card.connector?.connectedAccounts === "number" ? (
                  <p className="muted small">
                    {card.connector.connectedAccounts} connected account{card.connector.connectedAccounts === 1 ? "" : "s"}
                  </p>
                ) : null}
                <details className="social-setup-details">
                  <summary>Setup details</summary>
                  <div className="stack-sm">
                    <p className="muted small">{card.setupDescription}</p>
                    <p className="muted small">Redirect URI: <code>{redirectUris[card.provider]}</code></p>
                    {card.connector?.missingEnv && card.connector.missingEnv.length > 0 ? (
                      <p className="muted small">Developer setup required: {card.connector.missingEnv.join(", ")}</p>
                    ) : null}
                  </div>
                </details>
              </div>
              <div className="social-connector-actions">
                {card.authHref ? (
                  <a href={card.authHref} className="button primary">
                    {(card.connector?.connectedAccounts ?? 0) > 0 ? "Connect another" : card.actionLabel}
                  </a>
                ) : (
                  <StatusBadge tone="warning">Setup needed</StatusBadge>
                )}
              </div>
            </article>
          ))}
        </div>

        <details className="social-technical-readiness">
          <summary>Technical readiness</summary>
          <div className="growth-connector-list">
            {connectors.map((connector) => (
              <article key={connector.platform} className="growth-connector-row social-readiness-row">
                <div>
                  <div className="clip-badge-row">
                    <strong>{connector.platform}</strong>
                    <StatusBadge tone={statusTone(connector.status)}>{setupStatusLabel(connector.status)}</StatusBadge>
                  </div>
                  <p className="muted small">{connector.capability}</p>
                  {connector.missingEnv && connector.missingEnv.length > 0 ? (
                    <p className="muted small">Developer setup required: {connector.missingEnv.join(", ")}</p>
                  ) : null}
                  {typeof connector.connectedAccounts === "number" ? (
                    <p className="muted small">{connector.connectedAccounts} connected account{connector.connectedAccounts === 1 ? "" : "s"}</p>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </details>
      </SectionCard>
    </main>
  );
}
