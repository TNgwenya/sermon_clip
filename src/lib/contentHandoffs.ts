import { buildContentAssetHandoffText, normalizeContentHashtags } from "@/lib/contentPublishing";

export type HandoffContentAsset = {
  id: string;
  sermonId: string;
  title: string;
  assetType: string;
  bodyContent: string | null;
  caption: string | null;
  hashtags: string[];
  callToAction: string | null;
  sermon: {
    title: string;
    speakerName: string;
    churchName: string;
    sermonDate?: string | null;
  };
  files: Array<{
    fileName: string;
    mimeType: string;
    filePath: string | null;
    publicUrl: string | null;
    width: number | null;
    height: number | null;
  }>;
};

export function selectStoryMediaFiles<T extends {
  mimeType: string;
  width: number | null;
  height: number | null;
}>(files: T[]): T[] {
  const storyCompatible = files.filter((file) => (
    file.mimeType.startsWith("image/")
    && Boolean(file.width && file.height)
    && (file.height ?? 0) / Math.max(1, file.width ?? 1) >= 1.6
  ));
  const pngFiles = storyCompatible.filter((file) => file.mimeType === "image/png");
  return pngFiles.length > 0
    ? pngFiles
    : storyCompatible.filter((file) => file.mimeType === "image/jpeg");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function paragraphs(value: string): string {
  return value
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

export function buildWhatsAppHandoff(asset: HandoffContentAsset): string {
  const postCopy = buildContentAssetHandoffText({
    bodyContent: asset.bodyContent,
    caption: asset.caption,
    hashtags: asset.hashtags,
    callToAction: asset.callToAction,
  });
  const statusText = (asset.caption?.trim() || asset.bodyContent?.trim() || asset.title).slice(0, 700);
  const media = asset.files
    .filter((file) => file.publicUrl)
    .map((file) => `- ${file.fileName}: ${file.publicUrl}`)
    .join("\n");

  return [
    `# WhatsApp publishing pack — ${asset.title}`,
    `Sermon: ${asset.sermon.title}`,
    `Speaker: ${asset.sermon.speakerName}`,
    "",
    "## WhatsApp Status",
    statusText,
    "",
    "## Group or broadcast message",
    postCopy,
    "",
    "## Media-team checklist",
    "- Download the portrait or square image from the production asset.",
    "- Review names, Scripture, links, and service details before sending.",
    "- Obtain consent before adding people to a broadcast list.",
    media ? `\nRemote media:\n${media}` : "",
  ].join("\n").trimEnd();
}

export function buildStoryHandoffInstructions(asset: HandoffContentAsset): string {
  const storyFiles = selectStoryMediaFiles(asset.files);
  return [
    `# Story publishing pack — ${asset.title}`,
    `Sermon: ${asset.sermon.title}`,
    "",
    asset.caption?.trim() || asset.bodyContent?.trim() || "Story copy pending.",
    "",
    "## Native platform step",
    "Add polls, quizzes, sliders, music, link stickers, and question boxes manually inside Instagram or Facebook. Review the final placement before publishing.",
    "",
    "## Included Story assets",
    storyFiles.length > 0
      ? storyFiles.map((file, index) => `${index + 1}. ${file.fileName}${file.width && file.height ? ` (${file.width}×${file.height})` : ""}`).join("\n")
      : "No Story image is attached yet. Render a 1080×1920 Story asset before handoff.",
  ].join("\n");
}

export function buildHtmlEmailHandoff(asset: HandoffContentAsset): string {
  const content = asset.bodyContent?.trim() || asset.caption?.trim() || asset.title;
  const hashtags = normalizeContentHashtags(asset.hashtags).join(" ");
  const previewText = (asset.caption?.trim() || content).replace(/\s+/g, " ").slice(0, 140);
  const remoteImage = asset.files.find((file) => file.mimeType.startsWith("image/") && file.publicUrl)?.publicUrl ?? null;
  const image = remoteImage
    ? `<p><img src="${escapeHtml(remoteImage)}" alt="${escapeHtml(asset.title)}" style="display:block;max-width:100%;height:auto;border:0"></p>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(asset.title)}</title>
</head>
<body style="margin:0;background:#f5f4ef;color:#1f2933;font-family:Arial,sans-serif">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(previewText)}</div>
  <main style="max-width:680px;margin:0 auto;padding:32px 20px;background:#ffffff">
    <p style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#667085">${escapeHtml(asset.sermon.churchName)}</p>
    <h1 style="font-size:32px;line-height:1.2;margin:12px 0">${escapeHtml(asset.title)}</h1>
    <p style="color:#667085">From “${escapeHtml(asset.sermon.title)}” with ${escapeHtml(asset.sermon.speakerName)}</p>
    ${image}
    <section style="font-size:17px;line-height:1.65">${paragraphs(content)}</section>
    ${asset.callToAction ? `<p style="margin-top:28px;font-weight:700">${escapeHtml(asset.callToAction)}</p>` : ""}
    ${hashtags ? `<p style="margin-top:24px;color:#667085">${escapeHtml(hashtags)}</p>` : ""}
    <hr style="border:0;border-top:1px solid #e5e7eb;margin:32px 0">
    <p style="font-size:12px;color:#667085">Review all Scripture references, names, dates, links, consent, and unsubscribe requirements in your email platform before sending.</p>
  </main>
</body>
</html>`;
}

export const __contentHandoffsTestUtils = { escapeHtml };
