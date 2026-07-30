/* eslint-disable @next/next/no-img-element */
import type { CSSProperties } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import styles from "@/app/s/[slug]/public-sermon.module.css";
import { loadPublicSermonPage } from "@/server/publicSermon/publicSermonService";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ slug: string }>;
};

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const page = await loadPublicSermonPage(slug);
  if (!page) {
    return {
      title: "Sermon not found",
      robots: { index: false, follow: false },
    };
  }
  const description = page.summary
    || `Watch ${page.sermon.title} from ${page.church.name}.`;
  return {
    title: `${page.title} — ${page.church.name}`,
    description,
    alternates: { canonical: `/s/${page.slug}` },
    openGraph: {
      title: page.title,
      description,
      type: "article",
      publishedTime: page.publishedAt ?? undefined,
      siteName: page.church.name,
      url: `/s/${page.slug}`,
    },
    twitter: {
      card: "summary",
      title: page.title,
      description,
    },
  };
}

export default async function PublicSermonPage({ params }: PageProps) {
  const { slug } = await params;
  const page = await loadPublicSermonPage(slug);
  if (!page) notFound();

  const brandStyle = {
    "--public-primary": page.church.primaryColor,
    "--public-secondary": page.church.secondaryColor,
  } as CSSProperties;
  const sermonDate = formatDate(page.sermon.sermonDate);

  return (
    <main className={styles.publicPage} data-public-sermon-page style={brandStyle}>
      <header className={styles.siteHeader}>
        <Link href={`/s/${page.slug}`} className={styles.churchBrand} aria-label={`${page.church.name} sermon home`}>
          {page.church.logoEndpoint ? (
            <img src={page.church.logoEndpoint} alt="" width="44" height="44" />
          ) : (
            <span aria-hidden="true">{page.church.name.slice(0, 1).toUpperCase()}</span>
          )}
          <strong>{page.church.name}</strong>
        </Link>
        <a href={page.sermon.youtubeWatchUrl} target="_blank" rel="noreferrer" className={styles.youtubeLink}>
          Watch on YouTube
        </a>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>A message from {page.church.name}</p>
          <h1>{page.title}</h1>
          {page.summary ? <p className={styles.summary}>{page.summary}</p> : null}
          <div className={styles.sermonMeta}>
            <span>{page.sermon.speakerName}</span>
            {sermonDate ? <span>{sermonDate}</span> : null}
            {page.sermon.scriptureReferences.slice(0, 3).map((reference) => (
              <span key={reference}>{reference}</span>
            ))}
          </div>
          {page.ctaEndpoint && page.primaryCtaLabel ? (
            <form method="post" action={page.ctaEndpoint}>
              <button type="submit" className={styles.primaryCta}>{page.primaryCtaLabel}</button>
            </form>
          ) : null}
        </div>
        <div className={styles.videoFrame}>
          <iframe
            src={page.sermon.youtubeEmbedUrl}
            title={`${page.sermon.title} sermon video`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      </section>

      <section className={styles.messageIntro}>
        <p className={styles.eyebrow}>From this message</p>
        <h2>Keep reflecting through the week.</h2>
        <p>Approved notes, prayers, and shareable resources from this sermon.</p>
      </section>

      {page.assets.length > 0 ? (
        <section className={styles.assetGrid} aria-label="Approved sermon resources">
          {page.assets.map((asset) => (
            <article key={asset.id} className={`${styles.assetCard} ${styles[asset.assetType.toLowerCase()] ?? ""}`}>
              {asset.media.length > 0 ? (
                <div className={asset.media.length > 1 ? styles.carousel : styles.assetMedia}>
                  {asset.media.map((media) => (
                    <img
                      key={media.id}
                      src={media.url}
                      alt={media.alt}
                      width={media.width ?? 1080}
                      height={media.height ?? 1080}
                      loading="lazy"
                    />
                  ))}
                </div>
              ) : null}
              <div className={styles.assetCopy}>
                <span>{asset.assetType.replace(/_/g, " ").toLowerCase()}</span>
                <h3>{asset.title}</h3>
                {asset.body ? <p className={styles.assetBody}>{asset.body}</p> : null}
                {!asset.body && asset.caption ? <p>{asset.caption}</p> : null}
                {asset.callToAction ? <strong className={styles.assetCta}>{asset.callToAction}</strong> : null}
                {asset.hashtags.length > 0 ? (
                  <p className={styles.hashtags}>{asset.hashtags.join(" ")}</p>
                ) : null}
              </div>
            </article>
          ))}
        </section>
      ) : (
        <section className={styles.emptyResources}>
          <p className={styles.eyebrow}>Watch the full message</p>
          <h2>This sermon is the heart of the page.</h2>
          <p>Additional church-approved resources may be added here later.</p>
        </section>
      )}

      <footer className={styles.footer}>
        <div>
          <strong>{page.church.name}</strong>
          <span>We hope this message helps you take your next faithful step.</span>
        </div>
        <span>Powered by SermonClip</span>
      </footer>
    </main>
  );
}
