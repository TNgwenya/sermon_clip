import Image from "next/image";
import Link from "next/link";

import { isEditoriallyPostReady } from "@/app/ready-to-post/readiness-display";
import type { ReadyContentAsset } from "@/app/ready-to-post/generated-content-assets";
import type { ReadyQueueClip } from "@/app/ready-to-post/ready-queue-experience";
import { CONTENT_ASSET_TYPE_LABELS } from "@/lib/contentPublishing";

export type SermonPublishingClip = ReadyQueueClip & {
  exportedAt: string | null;
  sermon: ReadyQueueClip["sermon"] & {
    sermonDate: string | null;
  };
};

export type SermonPublishingAsset = ReadyContentAsset & {
  sermonChurchName: string;
  sermonDate: string | null;
  updatedAt: string;
};

export type SermonPublishingGroup = {
  sermonId: string;
  title: string;
  churchName: string;
  sermonDate: string | null;
  activityAt: string | null;
  clips: SermonPublishingClip[];
  contentAssets: SermonPublishingAsset[];
};

function timestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function buildSermonPublishingGroups(
  clips: SermonPublishingClip[],
  contentAssets: SermonPublishingAsset[],
): SermonPublishingGroup[] {
  const groups = new Map<string, SermonPublishingGroup>();

  function ensureGroup(input: {
    sermonId: string;
    title: string;
    churchName: string;
    sermonDate: string | null;
  }): SermonPublishingGroup {
    const existing = groups.get(input.sermonId);
    if (existing) return existing;

    const group: SermonPublishingGroup = {
      sermonId: input.sermonId,
      title: input.title,
      churchName: input.churchName,
      sermonDate: input.sermonDate,
      activityAt: null,
      clips: [],
      contentAssets: [],
    };
    groups.set(input.sermonId, group);
    return group;
  }

  clips.forEach((clip) => {
    const group = ensureGroup({
      sermonId: clip.sermon.id,
      title: clip.sermon.title,
      churchName: clip.sermon.churchName,
      sermonDate: clip.sermon.sermonDate,
    });
    group.clips.push(clip);
    if (timestamp(clip.exportedAt) > timestamp(group.activityAt)) group.activityAt = clip.exportedAt;
  });

  contentAssets.forEach((asset) => {
    const group = ensureGroup({
      sermonId: asset.sermonId,
      title: asset.sermonTitle,
      churchName: asset.sermonChurchName,
      sermonDate: asset.sermonDate,
    });
    group.contentAssets.push(asset);
    if (timestamp(asset.updatedAt) > timestamp(group.activityAt)) group.activityAt = asset.updatedAt;
  });

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      clips: [...group.clips].sort((left, right) => timestamp(right.exportedAt) - timestamp(left.exportedAt)),
      contentAssets: [...group.contentAssets].sort((left, right) => timestamp(right.updatedAt) - timestamp(left.updatedAt)),
    }))
    .sort((left, right) => (
      timestamp(right.activityAt) - timestamp(left.activityAt)
      || left.title.localeCompare(right.title)
    ));
}

function formatSermonDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function contentAssetStatusLabel(asset: SermonPublishingAsset): string {
  if (asset.currentRevision?.approvalState === "REAPPROVAL_REQUIRED") return "Review required";
  if (asset.status === "GENERATED" || asset.status === "APPROVED") return "Needs preparation";
  if (asset.status === "PREPARED") return "Prepared";
  if (asset.status === "READY") return "Ready to post";
  if (asset.status === "SCHEDULED") return "Scheduled";
  if (asset.status === "PUBLISHED") return "Published";
  return asset.status.toLowerCase();
}

function clipStatusLabel(clip: SermonPublishingClip): string {
  if (!clip.mediaReady) return "Media needs repair";
  if (!isEditoriallyPostReady(clip)) return "Review recommended";
  return "Ready to post";
}

function groupCounts(group: SermonPublishingGroup) {
  const readyClips = group.clips.filter((clip) => clip.mediaReady && isEditoriallyPostReady(clip)).length;
  const readyContent = group.contentAssets.filter((asset) => asset.status === "READY").length;
  const scheduled = group.contentAssets.filter((asset) => asset.status === "SCHEDULED").length;
  const needsAttention = group.clips.filter((clip) => !clip.mediaReady || !isEditoriallyPostReady(clip)).length
    + group.contentAssets.filter((asset) => (
      ["GENERATED", "APPROVED", "PREPARED"].includes(asset.status)
      || asset.currentRevision?.approvalState === "REAPPROVAL_REQUIRED"
    )).length;

  return { readyClips, readyContent, scheduled, needsAttention };
}

function SermonLibraryCard({ group }: { group: SermonPublishingGroup }) {
  const counts = groupCounts(group);
  const previewItems = [
    ...group.clips.map((clip) => ({ id: clip.id, kind: "Clip", title: clip.title })),
    ...group.contentAssets.map((asset) => ({
      id: asset.id,
      kind: CONTENT_ASSET_TYPE_LABELS[asset.assetType],
      title: asset.title,
    })),
  ].slice(0, 4);
  const itemCount = group.clips.length + group.contentAssets.length;

  return (
    <article className="sermon-library-card">
      <div className="sermon-library-card-head">
        <div>
          <p className="kicker">{group.churchName || "Sermon"}</p>
          <h3>{group.title}</h3>
          {formatSermonDate(group.sermonDate) ? <p className="muted small">{formatSermonDate(group.sermonDate)}</p> : null}
        </div>
        <span className="sermon-library-total">{itemCount}<small>items</small></span>
      </div>

      <div className="sermon-library-metrics" aria-label={`Publishing summary for ${group.title}`}>
        <span><strong>{group.clips.length}</strong> clips</span>
        <span><strong>{group.contentAssets.length}</strong> post assets</span>
        <span><strong>{counts.readyClips + counts.readyContent}</strong> ready</span>
        {counts.scheduled > 0 ? <span><strong>{counts.scheduled}</strong> scheduled</span> : null}
      </div>

      <ul className="sermon-library-preview" aria-label={`Recent content from ${group.title}`}>
        {previewItems.map((item) => (
          <li key={`${item.kind}-${item.id}`}><span>{item.kind}</span><strong>{item.title}</strong></li>
        ))}
      </ul>

      <div className="sermon-library-card-footer">
        <span className={counts.needsAttention > 0 ? "needs-attention" : "is-ready"}>
          {counts.needsAttention > 0 ? `${counts.needsAttention} to review` : "All reviewed"}
        </span>
        <Link className="button primary" href={`/ready-to-post?sermonId=${encodeURIComponent(group.sermonId)}`}>
          Open sermon
        </Link>
      </div>
    </article>
  );
}

function SermonAssetWorkspace({ group }: { group: SermonPublishingGroup }) {
  const counts = groupCounts(group);

  return (
    <section id="sermon-assets" className="sermon-publishing-focus stack-lg" aria-label={`Publishing content from ${group.title}`}>
      <div className="sermon-focus-toolbar">
        <Link className="sermon-focus-back" href="/ready-to-post">← All sermons</Link>
        <div className="sermon-focus-links">
          <a href="#sermon-assets">All sermon assets</a>
          <a href="#publishing-operations">Publishing tools</a>
          <a href="#posting-calendar">Calendar</a>
        </div>
      </div>

      <header className="sermon-focus-header">
        <div>
          <p className="kicker">Sermon publishing workspace</p>
          <h2>{group.title}</h2>
          <p className="muted">
            Review every finished clip and derived post from this message together, then choose what is ready to publish.
          </p>
          <p className="sermon-focus-byline">
            {group.churchName || "Church message"}
            {formatSermonDate(group.sermonDate) ? ` · ${formatSermonDate(group.sermonDate)}` : ""}
          </p>
        </div>
        <div className="sermon-focus-metrics" aria-label="Sermon content totals">
          <span><strong>{group.clips.length}</strong> finished clips</span>
          <span><strong>{group.contentAssets.length}</strong> derived posts</span>
          <span><strong>{counts.readyClips + counts.readyContent}</strong> ready now</span>
          <span><strong>{counts.needsAttention}</strong> to review</span>
        </div>
      </header>

      {group.clips.length + group.contentAssets.length === 0 ? (
        <div className="sermon-publishing-empty">
          <h3>No prepared content from this sermon yet</h3>
          <p className="muted">Approved clips and generated content will appear here as they are prepared.</p>
        </div>
      ) : (
        <div className="sermon-asset-grid">
          {group.clips.map((clip) => (
            <article key={clip.id} className="sermon-asset-card sermon-asset-clip">
              <div className="sermon-asset-visual">
                <Image
                  src={`/api/clips/${clip.id}/thumbnail`}
                  alt=""
                  width={180}
                  height={320}
                  unoptimized
                />
                <span>Clip</span>
              </div>
              <div className="sermon-asset-copy">
                <div className="sermon-asset-badges">
                  <span className={`status-pill ${clip.mediaReady && isEditoriallyPostReady(clip) ? "status-exported" : "tone-warning"}`}>
                    {clipStatusLabel(clip)}
                  </span>
                  {clip.smartClipCategory ? <span className="status-pill">{clip.smartClipCategory}</span> : null}
                </div>
                <h3>{clip.title}</h3>
                <p className="muted small">{clip.hook || clip.caption || "Prepared sermon clip"}</p>
                <Link className="button secondary" href={`/ready-to-post?sermonId=${encodeURIComponent(group.sermonId)}&clipId=${encodeURIComponent(clip.id)}#ready-clips`}>
                  Review clip
                </Link>
              </div>
            </article>
          ))}

          {group.contentAssets.map((asset) => {
            const previewFile = asset.files.find((file) => file.mimeType.startsWith("image/")) ?? null;
            const statusLabel = contentAssetStatusLabel(asset);
            return (
              <article key={asset.id} className="sermon-asset-card sermon-asset-content">
                <div className="sermon-asset-visual">
                  {previewFile ? (
                    <Image
                      src={`/api/content-assets/${asset.id}/files/${previewFile.id}`}
                      alt=""
                      width={320}
                      height={320}
                      unoptimized
                    />
                  ) : (
                    <div className="sermon-asset-placeholder" aria-hidden="true">
                      <span>{CONTENT_ASSET_TYPE_LABELS[asset.assetType].slice(0, 2).toUpperCase()}</span>
                    </div>
                  )}
                  <span>{CONTENT_ASSET_TYPE_LABELS[asset.assetType]}</span>
                </div>
                <div className="sermon-asset-copy">
                  <div className="sermon-asset-badges">
                    <span className={`status-pill ${asset.status === "READY" ? "status-exported" : asset.status === "PUBLISHED" ? "status-approved" : ""}`}>
                      {statusLabel}
                    </span>
                    {asset.platform ? <span className="status-pill">{asset.platform.replace(/_/g, " ").toLowerCase()}</span> : null}
                  </div>
                  <h3>{asset.title}</h3>
                  <p className="muted small">{asset.caption?.trim() || asset.bodyContent?.trim() || "Generated post ready for review"}</p>
                  <Link className="button secondary" href={`/ready-to-post?sermonId=${encodeURIComponent(group.sermonId)}&contentAssetId=${encodeURIComponent(asset.id)}#generated-content-assets`}>
                    Review post asset
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function SermonPublishingLibrary({
  clips,
  contentAssets,
  activeSermonId,
  activeSermon,
}: {
  clips: SermonPublishingClip[];
  contentAssets: SermonPublishingAsset[];
  activeSermonId?: string | null;
  activeSermon?: {
    id: string;
    title: string;
    churchName: string;
    sermonDate: string | null;
  } | null;
}) {
  const groups = buildSermonPublishingGroups(clips, contentAssets);
  const activeGroup = activeSermonId
    ? groups.find((group) => group.sermonId === activeSermonId)
      ?? (activeSermon?.id === activeSermonId ? {
        sermonId: activeSermon.id,
        title: activeSermon.title,
        churchName: activeSermon.churchName,
        sermonDate: activeSermon.sermonDate,
        activityAt: null,
        clips: [],
        contentAssets: [],
      } : null)
    : null;

  if (activeGroup) return <SermonAssetWorkspace group={activeGroup} />;

  return (
    <section id="sermon-library" className="sermon-publishing-library stack-lg" aria-label="Sermons with publishing content">
      <header className="sermon-library-heading">
        <div>
          <p className="kicker">Sermon content library</p>
          <h2>Choose a sermon. See everything it created.</h2>
          <p className="muted">Clips, graphics, written posts, and prepared campaign assets stay with their source sermon until you decide what to share.</p>
        </div>
        <Link className="button secondary" href="/sermons">View all sermons</Link>
      </header>

      {groups.length === 0 ? (
        <div className="sermon-publishing-empty">
          <h3>No sermons have prepared publishing content yet</h3>
          <p className="muted">Approve a clip or prepare a generated content idea and its sermon workspace will appear here.</p>
          <Link className="button primary" href="/sermons">Open sermons</Link>
        </div>
      ) : (
        <div className="sermon-library-grid">
          {groups.map((group) => <SermonLibraryCard key={group.sermonId} group={group} />)}
        </div>
      )}
    </section>
  );
}
