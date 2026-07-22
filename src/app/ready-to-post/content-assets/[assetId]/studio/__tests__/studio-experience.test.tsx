import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/server/actions/contentAssetStudio", () => ({
  saveContentAssetDesignAction: vi.fn(),
}));

import {
  __studioExperienceTestUtils,
  ContentAssetDesignStudio,
} from "@/app/ready-to-post/content-assets/[assetId]/studio/studio-experience";
import {
  createDefaultContentArtworkTextOverrides,
  createDefaultContentArtworkSettings,
  type ContentArtworkTextOverrides,
} from "@/lib/contentArtworkDesign";

function renderStudio({
  brandingChangedSinceRender = false,
  hasRenderedFile = false,
  textOverrides,
}: {
  brandingChangedSinceRender?: boolean;
  hasRenderedFile?: boolean;
  textOverrides?: ContentArtworkTextOverrides;
} = {}): string {
  return renderToStaticMarkup(
    <ContentAssetDesignStudio
      initialAsset={{
        id: "asset-1",
        assetType: "QUOTE_GRAPHIC",
        status: hasRenderedFile ? "READY" : "PREPARED",
        title: "Keep walking",
        bodyContent: "Faith keeps walking when pressure comes.",
        sermonTitle: "Courage under pressure",
        relatedScripture: "Pastor Jordan · Sunday message",
        scriptureTranslation: null,
        sourceTranscriptExcerpt: "Faith keeps walking when pressure comes.",
        sourceOpportunityStatus: "APPROVED",
        brandingChangedSinceRender,
        design: {
          version: 2,
          templateId: "quote-emphasis",
          slides: [],
          artwork: createDefaultContentArtworkSettings("quote-emphasis"),
          textOverrides: textOverrides ?? createDefaultContentArtworkTextOverrides(),
        },
        updatedAt: "2030-01-01T08:00:00.000Z",
        files: hasRenderedFile ? [{
          id: "file-1",
          fileName: "quote-square.png",
          mimeType: "image/png",
          width: 1080,
          height: 1080,
          sortOrder: 0,
        }] : [],
      }}
      branding={{
        churchName: "Grace Church",
        primaryColor: "#17324d",
        secondaryColor: "#d79c42",
        fontFamily: "Arial",
        logoDataUrl: null,
      }}
    />,
  );
}

describe("ContentAssetDesignStudio artwork experience", () => {
  it("starts with twelve finished directions using the approved copy", () => {
    const markup = renderStudio();

    expect(markup).toContain("12 options");
    expect(markup).toContain("Church brand starter");
    expect(markup).not.toContain("Best for this message");
    expect(markup).toContain("All designs");
    expect(markup).toContain("Still waters");
    expect(markup).toContain("New mercies");
    expect(markup).toContain("Sunday editorial");
    expect(markup).toContain("Radiant declaration");
    expect(markup).toContain("Church signature");
    expect(markup).toContain("Midnight minimal");
    expect(markup).toContain("Faith keeps walking when pressure comes.");
    expect(markup).not.toContain("Choose a look");
  });

  it("keeps advanced controls and source editing progressive", () => {
    const markup = renderStudio();

    expect(markup).toContain("Customize this design");
    expect(markup).toContain("Background, type, colour, crop and church mark");
    expect(markup).toContain("Text composition");
    expect(markup).toContain("Image treatment");
    expect(markup).toContain("Focal point");
    expect(markup).toContain("Save as my style");
    expect(markup).toContain("Edit words and source");
    expect(markup).toContain("Supporting wording");
    expect(markup).toContain("Top label");
    expect(markup).toContain("Template default: FROM THE MESSAGE");
    expect(markup).toContain("Footer / church text");
    expect(markup).toContain("Brand Kit default: Grace Church");
    expect(markup).toContain("Reset to template");
    expect(markup).toContain("Use Brand Kit");
    expect(markup).toContain('id="artwork-top-label"');
    expect(markup).toContain('maxLength="48"');
    expect(markup).toContain('id="artwork-footer-text"');
    expect(markup).toContain('maxLength="60"');
    expect(markup).toContain("Check against the sermon transcript");
    expect(markup.match(/type="range"/g)).toHaveLength(6);
    expect(markup.match(/<details/g)?.length).toBeGreaterThanOrEqual(3);
    expect(markup).not.toMatch(/<details class="[^"]*customizer[^"]*" open/);
  });

  it("keeps carousel slide controls alongside the expanded design gallery", () => {
    const markup = renderToStaticMarkup(
      <ContentAssetDesignStudio
        initialAsset={{
          id: "carousel-1",
          assetType: "CAROUSEL",
          status: "PREPARED",
          title: "Three ways to keep walking",
          bodyContent: "",
          sermonTitle: "Courage under pressure",
          relatedScripture: "James 1:2–4 NIV",
          scriptureTranslation: "NIV",
          sourceTranscriptExcerpt: null,
          sourceOpportunityStatus: "APPROVED",
          brandingChangedSinceRender: false,
          design: {
            version: 2,
            templateId: "carousel-cover",
            artwork: createDefaultContentArtworkSettings("carousel-cover"),
            textOverrides: createDefaultContentArtworkTextOverrides(),
            slides: [{
              id: "slide-1",
              role: "COVER",
              templateId: "carousel-cover",
              title: "Keep walking",
              body: "Pressure does not have the final word.",
              scripture: "James 1:2–4 NIV",
              textOverrides: {
                version: 1,
                eyebrowText: "SLIDE SERIES",
                footerText: "Youth Ministry",
                showEyebrow: true,
                showFooter: true,
              },
            }],
          },
          updatedAt: "2030-01-01T08:00:00.000Z",
          files: [],
        }}
        branding={{
          churchName: "Grace Church",
          primaryColor: "#17324d",
          secondaryColor: "#d79c42",
          fontFamily: "Arial",
          logoDataUrl: null,
        }}
      />,
    );

    expect(markup).toContain("1 slide carousel");
    expect(markup).toContain("Add slide");
    expect(markup).toContain("Slide type");
    expect(markup).toContain("Move slide earlier");
    expect(markup).toContain("Remove slide");
    expect(markup).toContain("12 options");
    expect(markup).toContain("SLIDE SERIES");
    expect(markup).toContain("Youth Ministry");
    expect(markup).toMatch(/id="studio-words-editor"[^>]*open/);
  });

  it("rejects legacy and incompatible reusable styles", () => {
    const settings = createDefaultContentArtworkSettings("quote-emphasis");
    const legacy = JSON.stringify([{
      id: "legacy",
      label: "Legacy style",
      templateId: "quote-emphasis",
      artwork: settings,
    }]);
    const stored = JSON.stringify([{
      id: "quote-style",
      label: "Quote style",
      assetType: "QUOTE_GRAPHIC",
      slideRole: null,
      templateId: "quote-emphasis",
      artwork: settings,
    }, {
      id: "cover-style",
      label: "Cover style",
      assetType: "CAROUSEL",
      slideRole: "COVER",
      templateId: "carousel-cover",
      artwork: createDefaultContentArtworkSettings("carousel-cover"),
    }]);

    expect(__studioExperienceTestUtils.readSavedArtworkStyles(legacy)).toEqual([]);
    const [quoteStyle, coverStyle] = __studioExperienceTestUtils.readSavedArtworkStyles(stored);
    const wrongTemplateStyle = {
      ...quoteStyle,
      templateId: "scripture-focus" as const,
    };
    expect(__studioExperienceTestUtils.isSavedArtworkStyleCompatible(quoteStyle, "QUOTE_GRAPHIC", null)).toBe(true);
    expect(__studioExperienceTestUtils.isSavedArtworkStyleCompatible(quoteStyle, "SCRIPTURE_GRAPHIC", null)).toBe(false);
    expect(__studioExperienceTestUtils.isSavedArtworkStyleCompatible(wrongTemplateStyle, "QUOTE_GRAPHIC", null)).toBe(false);
    expect(__studioExperienceTestUtils.isSavedArtworkStyleCompatible(coverStyle, "CAROUSEL", "COVER")).toBe(true);
    expect(__studioExperienceTestUtils.isSavedArtworkStyleCompatible(coverStyle, "CAROUSEL", "CONTENT")).toBe(false);
  });

  it("keeps legacy carousel preview wording aligned with production fallback rules", () => {
    const globalOverrides: ContentArtworkTextOverrides = {
      version: 1,
      eyebrowText: "MESSAGE SERIES",
      footerText: "Grace Online",
      showEyebrow: true,
      showFooter: true,
    };
    const slide = {
      id: "slide-1",
      role: "COVER" as const,
      templateId: "carousel-cover" as const,
      title: "Keep walking",
      body: "Pressure does not have the final word.",
      scripture: null,
    };

    expect(__studioExperienceTestUtils.resolvePreviewTextOverrides(slide, globalOverrides)).toEqual(globalOverrides);
    expect(__studioExperienceTestUtils.resolvePreviewTextOverrides({
      ...slide,
      textOverrides: {
        ...globalOverrides,
        eyebrowText: "SLIDE ONE",
      },
    }, globalOverrides)).toMatchObject({ eyebrowText: "SLIDE ONE", footerText: "Grace Online" });
  });

  it("separates stale approved downloads from the current branded preview", () => {
    const markup = renderStudio({ brandingChangedSinceRender: true, hasRenderedFile: true });

    expect(markup).toContain("Branding changed since the last render");
    expect(markup).toContain("Approve and render again before scheduling");
    expect(markup).toContain("Last approved output");
    expect(markup).toContain("These downloads show the last approved render");
    expect(markup).toContain("The live preview includes new branding");
    expect(markup).not.toContain("Approved production files");
  });

  it("keeps Scripture confirmation visible and linked to the final render action", () => {
    const markup = renderToStaticMarkup(
      <ContentAssetDesignStudio
        initialAsset={{
          id: "scripture-1",
          assetType: "SCRIPTURE_GRAPHIC",
          status: "PREPARED",
          title: "The Lord is my shepherd",
          bodyContent: "The Lord is my shepherd, I lack nothing.",
          sermonTitle: "The Shepherd's care",
          relatedScripture: "Psalm 23:1 NIV",
          scriptureTranslation: "NIV",
          sourceTranscriptExcerpt: null,
          sourceOpportunityStatus: "APPROVED",
          brandingChangedSinceRender: false,
          design: {
            version: 2,
            templateId: "scripture-focus",
            slides: [],
            artwork: createDefaultContentArtworkSettings("scripture-focus"),
            textOverrides: createDefaultContentArtworkTextOverrides(),
          },
          updatedAt: "2030-01-01T08:00:00.000Z",
          files: [],
        }}
        branding={{
          churchName: "Grace Church",
          primaryColor: "#17324d",
          secondaryColor: "#d79c42",
          fontFamily: "Arial",
          logoDataUrl: null,
        }}
      />,
    );

    expect(markup).toContain("Scripture approval required");
    expect(markup).toContain("Review Scripture and confirm");
    expect(markup).toContain('aria-controls="studio-words-editor"');
    expect(markup).toContain('aria-describedby="scripture-approval-blocker"');
    expect(markup).toMatch(/id="studio-words-editor"[^>]*open/);
    expect(markup).toContain("Translation accuracy check");
  });

  it("applies non-carousel top-label and footer overrides to live and gallery artwork", () => {
    const markup = renderStudio({
      textOverrides: {
        version: 1,
        eyebrowText: "WEEKLY HOPE",
        footerText: "Grace Online",
        showEyebrow: true,
        showFooter: true,
      },
    });

    expect(markup).toContain('value="WEEKLY HOPE"');
    expect(markup).toContain('value="Grace Online"');
    expect(markup.match(/WEEKLY HOPE/g)?.length).toBeGreaterThan(3);
    expect(markup.match(/Grace Online/g)?.length).toBeGreaterThan(3);
  });
});
