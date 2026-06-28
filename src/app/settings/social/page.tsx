import Link from "next/link";

import { SectionCard, StatusBadge } from "@/components/ui";
import {
  buildMetaOAuthUrl,
  buildOAuthRedirectUri,
  buildThreadsOAuthUrl,
  buildTikTokOAuthUrl,
  buildYouTubeOAuthUrl,
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
      message: `${params.provider ?? "Provider"} OAuth failed: ${params.reason ?? "unknown error"}.`,
    };
  }

  return null;
}

export default async function SocialSettingsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const connectors = await listSocialAnalyticsConnectors();
  const youtubeClientId = process.env.YOUTUBE_CLIENT_ID?.trim();
  const metaAppId = process.env.META_APP_ID?.trim();
  const tiktokClientKey = process.env.TIKTOK_CLIENT_KEY?.trim();
  const threadsAppId = process.env.THREADS_APP_ID?.trim();
  const youtubeAuthHref = youtubeClientId
    ? buildYouTubeOAuthUrl({
        clientId: youtubeClientId,
        redirectUri: buildOAuthRedirectUri("youtube"),
        state: "sermon-clip-growth-youtube",
      })
    : null;
  const metaAuthHref = metaAppId
    ? buildMetaOAuthUrl({
        appId: metaAppId,
        redirectUri: buildOAuthRedirectUri("meta"),
        state: "sermon-clip-growth-meta",
      })
    : null;
  const tiktokAuthHref = tiktokClientKey
    ? buildTikTokOAuthUrl({
        clientKey: tiktokClientKey,
        redirectUri: buildOAuthRedirectUri("tiktok"),
        state: "sermon-clip-growth-tiktok",
      })
    : null;
  const threadsAuthHref = threadsAppId
    ? buildThreadsOAuthUrl({
        appId: threadsAppId,
        redirectUri: buildOAuthRedirectUri("threads"),
        state: "sermon-clip-growth-threads",
      })
    : null;
  const banner = oauthBanner(params);

  return (
    <main className="growth-page-shell stack-lg">
      <header className="growth-hero">
        <div className="stack-sm">
          <p className="kicker">Social settings</p>
          <h1>Social connections.</h1>
          <p className="muted">
            Connect the church accounts Sermon Clip can use for analytics and approved automatic posting. Developer app credentials stay in environment variables.
          </p>
        </div>
        <nav className="topbar-actions">
          <Link href="/growth" className="button primary">Back to growth</Link>
        </nav>
      </header>

      {banner ? (
        <div className={banner.tone === "success" ? "success-banner" : "error-banner"}>
          <strong>{banner.title}</strong>
          <span>{banner.message}</span>
        </div>
      ) : null}

      <SectionCard title="Connected accounts" description="Authorize each platform once. Account tokens are stored encrypted and used for analytics sync and approved publishing actions.">
        <div className="growth-connector-list">
          <article className="growth-connector-row">
            <div>
              <strong>YouTube</strong>
              <p className="muted small">Redirect URI: <code>{buildOAuthRedirectUri("youtube")}</code></p>
              <p className="muted small">Uses analytics, readonly channel identity, and YouTube upload scopes.</p>
            </div>
            {youtubeAuthHref ? <a href={youtubeAuthHref} className="button primary">Connect YouTube</a> : <StatusBadge tone="warning">Missing env</StatusBadge>}
          </article>
          <article className="growth-connector-row">
            <div>
              <strong>Instagram / Facebook</strong>
              <p className="muted small">Redirect URI: <code>{buildOAuthRedirectUri("meta")}</code></p>
              <p className="muted small">Uses Meta Pages, posting, and Instagram business insights permissions.</p>
            </div>
            {metaAuthHref ? <a href={metaAuthHref} className="button primary">Connect Meta</a> : <StatusBadge tone="warning">Missing env</StatusBadge>}
          </article>
          <article className="growth-connector-row">
            <div>
              <strong>TikTok</strong>
              <p className="muted small">Redirect URI: <code>{buildOAuthRedirectUri("tiktok")}</code></p>
              <p className="muted small">Uses basic profile plus video publishing/list scopes where TikTok app review allows.</p>
            </div>
            {tiktokAuthHref ? <a href={tiktokAuthHref} className="button primary">Connect TikTok</a> : <StatusBadge tone="warning">Missing env</StatusBadge>}
          </article>
          <article className="growth-connector-row">
            <div>
              <strong>Threads</strong>
              <p className="muted small">Redirect URI: <code>{buildOAuthRedirectUri("threads")}</code></p>
              <p className="muted small">Uses Threads basic profile and insights scopes.</p>
            </div>
            {threadsAuthHref ? <a href={threadsAuthHref} className="button primary">Connect Threads</a> : <StatusBadge tone="warning">Missing env</StatusBadge>}
          </article>
        </div>
      </SectionCard>

      <SectionCard title="Connector readiness" description="A connector is ready when its app credentials and at least one OAuth credential are present. Some APIs still require platform app review before insights or publishing work.">
        <div className="growth-connector-list">
          {connectors.map((connector) => (
            <article key={connector.platform} className="growth-connector-row">
              <div>
                <div className="clip-badge-row">
                  <strong>{connector.platform}</strong>
                  <StatusBadge tone={statusTone(connector.status)}>{connector.status.replace(/_/g, " ")}</StatusBadge>
                </div>
                <p className="muted small">{connector.capability}</p>
                {connector.missingEnv && connector.missingEnv.length > 0 ? (
                  <p className="muted small">Missing env: {connector.missingEnv.join(", ")}</p>
                ) : null}
                {typeof connector.connectedAccounts === "number" ? (
                  <p className="muted small">{connector.connectedAccounts} connected account{connector.connectedAccounts === 1 ? "" : "s"}</p>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </SectionCard>
    </main>
  );
}
