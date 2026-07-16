import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { createZipArchive } from "@/lib/zipArchive";
import { slugifyExportName } from "@/lib/exportNaming";
import { renderBrandedContentSvg, splitCarouselSlides } from "@/lib/contentAssetRenderer";
import { getBrandingSettings } from "@/server/branding/settings";

export async function GET(
  _request: Request,
  context: { params: Promise<{ sermonId: string }> },
): Promise<NextResponse> {
  const { sermonId } = await context.params;
  const sermon = await prisma.sermon.findUnique({
    where: { id: sermonId },
    select: {
      title: true,
      speakerName: true,
      contentOpportunities: {
        where: { status: { in: ["APPROVED", "USED"] } },
        orderBy: [{ category: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          opportunityType: true,
          title: true,
          bodyContent: true,
          editedContent: true,
          approvedContent: true,
          relatedScripture: true,
          sourceTranscriptExcerpt: true,
          suggestedPlatform: true,
        },
      },
    },
  });

  if (!sermon) return NextResponse.json({ error: "Sermon not found." }, { status: 404 });
  if (sermon.contentOpportunities.length === 0) {
    return NextResponse.json({ error: "Approve at least one content item before downloading a production pack." }, { status: 409 });
  }

  const branding = await getBrandingSettings();
  const entries: Array<{ name: string; data: string }> = [];
  const manifest: string[] = [
    `# ${sermon.title} — approved content pack`,
    "",
    `Speaker: ${sermon.speakerName}`,
    `Generated for production: ${new Date().toISOString()}`,
    "Only APPROVED or USED items are included.",
    "",
  ];

  for (const item of sermon.contentOpportunities) {
    const content = item.approvedContent?.trim() || item.editedContent?.trim() || item.bodyContent;
    const base = `${slugifyExportName(item.title, "content")}-${item.id.slice(-6)}`;
    manifest.push(`## ${item.title}`, `Type: ${item.opportunityType}`, `Platform: ${item.suggestedPlatform ?? "Not specified"}`, `Scripture: ${item.relatedScripture ?? "Not specified"}`, "", content, "", item.sourceTranscriptExcerpt ? `Source evidence: ${item.sourceTranscriptExcerpt}` : "", "");
    entries.push({ name: `copy/${base}.txt`, data: `${item.title}\n\n${content}\n` });

    if (item.opportunityType === "QUOTE_GRAPHIC" || item.opportunityType === "SCRIPTURE_GRAPHIC") {
      for (const format of [{ name: "square", width: 1080, height: 1080 }, { name: "story", width: 1080, height: 1920 }]) {
        entries.push({
          name: `graphics/${base}-${format.name}.svg`,
          data: renderBrandedContentSvg({ title: item.title, content, scripture: item.relatedScripture, branding: { churchName: branding.churchName, primaryColor: branding.primaryBrandColor, secondaryColor: branding.secondaryBrandColor, fontFamily: branding.defaultFontFamily }, width: format.width, height: format.height }),
        });
      }
    }

    if (item.opportunityType === "CAROUSEL_IDEA") {
      splitCarouselSlides(content).forEach((slide, index) => entries.push({
        name: `carousels/${base}/slide-${String(index + 1).padStart(2, "0")}.svg`,
        data: renderBrandedContentSvg({ title: `${item.title} · ${index + 1}`, content: slide, scripture: item.relatedScripture, branding: { churchName: branding.churchName, primaryColor: branding.primaryBrandColor, secondaryColor: branding.secondaryBrandColor, fontFamily: branding.defaultFontFamily }, width: 1080, height: 1350 }),
      }));
    }
  }

  entries.unshift({ name: "README.md", data: manifest.filter(Boolean).join("\n") });
  const zip = createZipArchive(entries);
  const fileName = `${slugifyExportName(sermon.title, "sermon")}-content-production-pack.zip`;
  return new NextResponse(new Uint8Array(zip), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${fileName}"`, "Cache-Control": "no-store" },
  });
}
