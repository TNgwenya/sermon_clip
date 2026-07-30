import Link from "next/link";
import { notFound } from "next/navigation";

import { PublicSermonShareForm } from "@/app/sermons/[id]/share/share-form";
import styles from "@/app/sermons/[id]/share/share.module.css";
import { requireRequestCapability } from "@/server/auth/requestAuthorization";
import {
  loadManagedPublicSermonPage,
  normalizePublicSermonSlug,
} from "@/server/publicSermon/publicSermonService";
import { tenantScope } from "@/server/tenancy/scope";

export const dynamic = "force-dynamic";

function hasPubliclyEligibleAsset(asset: {
  status: string;
  currentRevisionId: string | null;
  approvedRevisionId: string | null;
  currentRevision: { approvalState: string } | null;
  approvedRevision: { approvalState: string } | null;
}): boolean {
  if (asset.approvedRevision?.approvalState === "APPROVED") return true;
  if (
    asset.currentRevisionId
    && asset.currentRevisionId === asset.approvedRevisionId
    && asset.currentRevision?.approvalState === "APPROVED"
  ) return true;
  return !asset.currentRevisionId && ["APPROVED", "READY", "PUBLISHED"].includes(asset.status);
}

export default async function PublicSermonSharePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const requestContext = await requireRequestCapability("content.update");
  const sermon = await loadManagedPublicSermonPage(id, tenantScope(requestContext));
  if (!sermon) notFound();

  const eligibleAssetCount = sermon.contentAssets.filter(hasPubliclyEligibleAsset).length;
  const defaultSlug = [
    normalizePublicSermonSlug(sermon.title),
    sermon.id.slice(-6).toLowerCase(),
  ].filter(Boolean).join("-").slice(0, 80);
  const page = sermon.publicPage;

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Public sermon growth hub</p>
          <h1>Give this message a lasting home.</h1>
          <p>
            Publish the sermon video and its approved resources on one church-branded page. Drafts, transcripts, team activity, and local files always stay private.
          </p>
        </div>
        <Link href={`/sermons/${sermon.id}`} className="button tertiary">Back to sermon</Link>
      </header>

      <section className={styles.readiness} aria-label="Public page readiness">
        <div>
          <span>Sermon</span>
          <strong>{sermon.title}</strong>
          <small>{sermon.speakerName} · {sermon.churchName}</small>
        </div>
        <div>
          <span>Approved resources</span>
          <strong>{eligibleAssetCount}</strong>
          <small>Only approved versions can appear</small>
        </div>
        <div>
          <span>Public status</span>
          <strong>{page?.status.toLowerCase() ?? "not created"}</strong>
          <small>{page?.publishedAt ? `Published ${new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(page.publishedAt)}` : "Publish when the page is ready"}</small>
        </div>
        <div>
          <span>Meaningful actions</span>
          <strong>{page?.ctaClickCount ?? 0}</strong>
          <small>Aggregate CTA clicks; no visitor profiles</small>
        </div>
      </section>

      <PublicSermonShareForm
        sermonId={sermon.id}
        initial={{
          slug: page?.slug ?? defaultSlug,
          title: page?.title ?? sermon.title,
          summary: page?.summary ?? "",
          primaryCtaLabel: page?.primaryCtaLabel ?? "",
          primaryCtaUrl: page?.primaryCtaUrl ?? "",
          status: page?.status ?? "DRAFT",
        }}
      />
    </main>
  );
}
