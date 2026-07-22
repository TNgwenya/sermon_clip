import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createDefaultContentArtworkSettings } from "@/lib/contentArtworkDesign";
import {
  analyzeNonVideoTextLayout,
  getNonVideoAssetOutputDirectory,
  preflightApprovedNonVideoAssets,
  renderApprovedNonVideoAssets,
  resolveRenderedScriptureReference,
  toContentAssetFilePersistenceInput,
  type ApprovedNonVideoAssetInput,
} from "@/server/contentAssets/nonVideoAssetRenderer";

const temporaryRoots: string[] = [];

function approvedInput(
  overrides: Partial<ApprovedNonVideoAssetInput> = {},
): ApprovedNonVideoAssetInput {
  return {
    sermonId: "sermon-1",
    opportunityId: "opportunity-1",
    opportunityType: "QUOTE_GRAPHIC",
    status: "APPROVED",
    title: "Choose faith",
    approvedContent: "Trust God with the next faithful step.",
    sourceTranscriptExcerpt: "Trust God with the next faithful step.",
    relatedScripture: "Proverbs 3:5",
    branding: {
      churchName: "Local Church",
      primaryColor: "#0F766E",
      secondaryColor: "#1D4ED8",
      fontFamily: "Arial",
    },
    ...overrides,
  };
}

async function makeTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "sermon-content-assets-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("approved non-video asset renderer", () => {
  it("renders deterministic PNG and platform-ready JPEG variants with persistence records", async () => {
    const root = await makeTemporaryRoot();
    const input = approvedInput();

    const first = await renderApprovedNonVideoAssets(input, { outputRoot: root });
    const second = await renderApprovedNonVideoAssets(input, { outputRoot: root });

    expect(first.preflight.ready).toBe(true);
    expect(first.files.map((file) => [file.name, file.width, file.height])).toEqual([
      ["square.png", 1080, 1080],
      ["portrait.png", 1080, 1350],
      ["story.png", 1080, 1920],
      ["facebook-landscape.png", 1200, 630],
      ["square.jpg", 1080, 1080],
      ["portrait.jpg", 1080, 1350],
      ["story.jpg", 1080, 1920],
      ["facebook-landscape.jpg", 1200, 630],
    ]);
    expect(second.files.map((file) => file.path)).toEqual(first.files.map((file) => file.path));
    expect(first.outputDirectory).toBe(path.join(root, "opportunity-1"));

    for (const file of first.files) {
      const bytes = await readFile(file.path);
      if (file.mime === "image/png") {
        expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
        expect(file.metadata.publishingFormat).toBe("PNG");
      } else {
        expect(Array.from(bytes.subarray(0, 3))).toEqual([0xff, 0xd8, 0xff]);
        expect(file.metadata.publishingFormat).toBe("JPEG");
      }
      expect(file.size).toBe(bytes.byteLength);
      expect(file.metadata.sourceStatus).toBe("APPROVED");
      expect(file.metadata.templateId).toBe("quote-emphasis");
    }

    expect(toContentAssetFilePersistenceInput(first.files[0])).toMatchObject({
      fileName: "square.png",
      mimeType: "image/png",
      filePath: path.join(root, "opportunity-1", "square.png"),
      width: 1080,
      height: 1080,
      sizeBytes: BigInt(first.files[0].size),
      sortOrder: 0,
    });
  });

  it("fits and renders a sermon-length quote across every social graphic variant", async () => {
    const root = await makeTemporaryRoot();
    const sermonQuote = "“Let us lay aside every weight and the sin which so easily ensnares us, and let us run with endurance the race that is set before us, looking unto Jesus.”";
    const result = await renderApprovedNonVideoAssets(approvedInput({
      title: "Looking unto Jesus",
      approvedContent: sermonQuote,
      sourceTranscriptExcerpt: sermonQuote,
      relatedScripture: "Hebrews 12:1-2",
    }), { outputRoot: root });

    expect(result.preflight.ready).toBe(true);
    expect(result.preflight.diagnostics).toEqual([]);
    expect(result.preflight.plannedFiles).toHaveLength(4);
    expect(result.preflight.plannedFiles.every((file) => (
      !file.layout.truncated
      && !file.layout.horizontalOverflow
      && !file.layout.verticalOverflow
    ))).toBe(true);
    expect(result.preflight.plannedFiles.map((file) => file.layout.safeArea.format)).toEqual([
      "SQUARE",
      "PORTRAIT",
      "STORY",
      "LANDSCAPE",
    ]);
    expect(result.preflight.plannedFiles.every((file) => (
      file.layout.startY >= file.layout.safeArea.top
      && file.layout.safeBottom < file.layout.referenceY
      && file.layout.referenceY < file.layout.brandY
      && file.layout.brandY <= file.layout.safeArea.bottom
    ))).toBe(true);
    expect(result.files).toHaveLength(8);
  });

  it("uses the selected photo recipe and typography settings in production output", async () => {
    const root = await makeTemporaryRoot();
    const artwork = {
      ...createDefaultContentArtworkSettings("quote-emphasis"),
      backgroundId: "still-waters" as const,
      paletteId: "ocean" as const,
      typographyPresetId: "quiet" as const,
      textScale: 1.1,
      lineHeight: 1.15,
    };
    const result = await renderApprovedNonVideoAssets(approvedInput({ artwork }), {
      outputRoot: root,
      variants: ["PORTRAIT"],
    });

    expect(result.files).toHaveLength(2);
    expect(result.files[0].metadata).toMatchObject({
      artworkVersion: 1,
      backgroundId: "still-waters",
      paletteId: "ocean",
      typographyPresetId: "quiet",
    });
    expect((await readFile(result.files[0].path)).byteLength).toBeGreaterThan(10_000);

    const defaultLayout = analyzeNonVideoTextLayout(
      "Trust God with the next faithful step.",
      1080,
      1350,
      "Choose faith",
      "Proverbs 3:5",
    );
    expect(result.preflight.plannedFiles[0].layout.baseFontSize).toBeGreaterThan(defaultLayout.baseFontSize);
    expect(result.preflight.plannedFiles[0].layout.lineHeight).not.toBe(defaultLayout.lineHeight);
  });

  it("normalizes and applies global text overrides to PNG and JPEG production output", async () => {
    const root = await makeTemporaryRoot();
    const baseline = await renderApprovedNonVideoAssets(approvedInput(), {
      outputRoot: root,
      storageKey: "baseline",
      variants: ["PORTRAIT"],
    });
    const customized = await renderApprovedNonVideoAssets(approvedInput({
      textOverrides: {
        eyebrowText: "  Sunday   message ",
        footerText: "  Melusi Church ",
        showEyebrow: false,
        showFooter: true,
      },
    }), {
      outputRoot: root,
      storageKey: "customized",
      variants: ["PORTRAIT"],
    });

    expect(customized.preflight.plannedFiles[0].textOverrides).toEqual({
      version: 1,
      eyebrowText: "Sunday message",
      footerText: "Melusi Church",
      showEyebrow: false,
      showFooter: true,
    });
    const baselinePng = await readFile(baseline.files.find((file) => file.mime === "image/png")!.path);
    const customizedPng = await readFile(customized.files.find((file) => file.mime === "image/png")!.path);
    const baselineJpeg = await readFile(baseline.files.find((file) => file.mime === "image/jpeg")!.path);
    const customizedJpeg = await readFile(customized.files.find((file) => file.mime === "image/jpeg")!.path);
    expect(customizedPng.equals(baselinePng)).toBe(false);
    expect(customizedJpeg.equals(baselineJpeg)).toBe(false);
  });

  it("keeps a selected textured family deterministic across every planned production size", () => {
    const first = preflightApprovedNonVideoAssets(approvedInput({ templateId: "quote-textured" }));
    const second = preflightApprovedNonVideoAssets(approvedInput({ templateId: "quote-textured" }));

    expect(first.ready).toBe(true);
    expect(first.plannedFiles.map((file) => file.templateId)).toEqual([
      "quote-textured",
      "quote-textured",
      "quote-textured",
      "quote-textured",
    ]);
    expect(second.plannedFiles).toEqual(first.plannedFiles);
  });

  it("renders approved carousel copy as ordered portrait PNG and JPEG slides", async () => {
    const root = await makeTemporaryRoot();
    const result = await renderApprovedNonVideoAssets(approvedInput({
      opportunityType: "CAROUSEL_IDEA",
      title: "Three faith steps",
      approvedContent: "Slide 1: Remember God's faithfulness\nSlide 2: Pray before reacting\nSlide 3: Take the next faithful step",
    }), { outputRoot: root });

    expect(result.files).toHaveLength(6);
    expect(result.files.map((file) => [file.name, file.width, file.height, file.order])).toEqual([
      ["slide-01.png", 1080, 1350, 0],
      ["slide-02.png", 1080, 1350, 1],
      ["slide-03.png", 1080, 1350, 2],
      ["slide-01.jpg", 1080, 1350, 3],
      ["slide-02.jpg", 1080, 1350, 4],
      ["slide-03.jpg", 1080, 1350, 5],
    ]);
    expect(result.files[2].path).toBe(path.join(root, "opportunity-1", "carousel", "slide-03.png"));
    expect(result.files[5].path).toBe(path.join(root, "opportunity-1", "carousel", "slide-03.jpg"));
    expect(result.files[2].metadata).toMatchObject({
      variant: "CAROUSEL_SLIDE",
      slideNumber: 3,
      slideCount: 3,
    });
  });

  it("uses a slide text override when present and otherwise falls back to the global override", async () => {
    const root = await makeTemporaryRoot();
    const globalOverrides = {
      version: 1 as const,
      eyebrowText: "Teaching point",
      footerText: "Global footer",
      showEyebrow: true,
      showFooter: true,
    };
    const slideOverrides = {
      version: 1 as const,
      eyebrowText: "First point",
      footerText: "Slide footer",
      showEyebrow: false,
      showFooter: true,
    };
    const result = await renderApprovedNonVideoAssets(approvedInput({
      opportunityType: "CAROUSEL_IDEA",
      title: "Faith steps",
      approvedContent: "Faith keeps moving.",
      textOverrides: globalOverrides,
      carouselSlides: [
        {
          id: "first",
          role: "CONTENT",
          templateId: "carousel-content",
          title: "Keep moving",
          body: "Faith keeps moving.",
          scripture: null,
          textOverrides: slideOverrides,
        },
        {
          id: "second",
          role: "CONTENT",
          templateId: "carousel-content",
          title: "Keep moving",
          body: "Faith keeps moving.",
          scripture: null,
        },
      ],
    }), { outputRoot: root });

    expect(result.preflight.plannedFiles.map((file) => file.textOverrides)).toEqual([
      slideOverrides,
      globalOverrides,
    ]);
    const firstPng = await readFile(result.files.find((file) => file.name === "slide-01.png")!.path);
    const secondPng = await readFile(result.files.find((file) => file.name === "slide-02.png")!.path);
    const firstJpeg = await readFile(result.files.find((file) => file.name === "slide-01.jpg")!.path);
    const secondJpeg = await readFile(result.files.find((file) => file.name === "slide-02.jpg")!.path);
    expect(firstPng.equals(secondPng)).toBe(false);
    expect(firstJpeg.equals(secondJpeg)).toBe(false);
  });

  it("keeps an intentionally blank carousel reference blank instead of inheriting the global reference", () => {
    const preflight = preflightApprovedNonVideoAssets(approvedInput({
      opportunityType: "CAROUSEL_IDEA",
      relatedScripture: "A deliberately long inherited reference that should not appear on this individual slide",
      carouselSlides: [{
        id: "cover",
        role: "COVER",
        templateId: "carousel-cover",
        title: "Choose faith",
        body: "Take the next faithful step.",
        scripture: null,
      }],
    }));

    expect(preflight.plannedFiles[0]?.scripture).toBeNull();
    expect(preflight.diagnostics).not.toContainEqual(expect.objectContaining({
      code: "SCRIPTURE_MAY_OVERFLOW",
      slideNumber: 1,
    }));
  });

  it("can isolate a render attempt without changing the source opportunity metadata", async () => {
    const root = await makeTemporaryRoot();
    const result = await renderApprovedNonVideoAssets(approvedInput(), {
      outputRoot: root,
      storageKey: "asset-1-attempt-2",
      variants: ["PORTRAIT"],
    });

    expect(result.outputDirectory).toBe(path.join(root, "asset-1-attempt-2"));
    expect(result.files).toHaveLength(2);
    expect(result.files[0].metadata.opportunityId).toBe("opportunity-1");
  });

  it("blocks draft content and never falls back to unapproved body copy", async () => {
    const root = await makeTemporaryRoot();
    const input = approvedInput({ status: "NEEDS_REVIEW", approvedContent: null });
    const preflight = preflightApprovedNonVideoAssets(input);

    expect(preflight.ready).toBe(false);
    expect(preflight.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining([
      "CONTENT_NOT_APPROVED",
      "APPROVED_CONTENT_MISSING",
    ]));
    await expect(renderApprovedNonVideoAssets(input, { outputRoot: root })).rejects.toThrow(
      "Only approved content can be rendered",
    );
  });

  it("reports text truncation and overflow as blocking preflight diagnostics", () => {
    const preflight = preflightApprovedNonVideoAssets(approvedInput({
      approvedContent: Array.from({ length: 180 }, (_, index) => `word${index}`).join(" "),
    }));

    expect(preflight.ready).toBe(false);
    expect(preflight.diagnostics.some((diagnostic) => (
      diagnostic.code === "CONTENT_WILL_TRUNCATE" || diagnostic.code === "CONTENT_WILL_OVERFLOW"
    ))).toBe(true);
  });

  it("blocks quote graphics that do not carry transcript evidence", () => {
    const preflight = preflightApprovedNonVideoAssets(approvedInput({
      sourceTranscriptExcerpt: null,
    }));

    expect(preflight.ready).toBe(false);
    expect(preflight.diagnostics).toContainEqual(expect.objectContaining({
      code: "QUOTE_TRANSCRIPT_EVIDENCE_MISSING",
      blocking: true,
    }));
  });

  it("blocks quote artwork that no longer matches the transcript evidence", () => {
    const preflight = preflightApprovedNonVideoAssets(approvedInput({
      approvedContent: "Pressure always makes your faith stronger.",
      sourceTranscriptExcerpt: "Faith keeps walking when pressure comes.",
    }));

    expect(preflight.ready).toBe(false);
    expect(preflight.diagnostics).toContainEqual(expect.objectContaining({
      code: "QUOTE_TRANSCRIPT_MISMATCH",
      blocking: true,
    }));
  });

  it("blocks invalid Scripture references and production directions before rendering", () => {
    const invalidReference = preflightApprovedNonVideoAssets(approvedInput({
      opportunityType: "SCRIPTURE_GRAPHIC",
      approvedContent: "The Lord is my shepherd.",
      relatedScripture: "Psalm ninety-one",
    }));
    const productionDirection = preflightApprovedNonVideoAssets(approvedInput({
      approvedContent: "Trust God today. Add a small footer with the church logo.",
      sourceTranscriptExcerpt: "Trust God today. Add a small footer with the church logo.",
    }));

    expect(invalidReference.diagnostics).toContainEqual(expect.objectContaining({
      code: "SCRIPTURE_REFERENCE_INVALID",
      blocking: true,
    }));
    expect(productionDirection.diagnostics).toContainEqual(expect.objectContaining({
      code: "PRODUCTION_COPY_UNSAFE",
      blocking: true,
    }));
  });

  it("requires a recognized displayed translation and an explicit human accuracy check for Scripture", () => {
    const missingVersion = preflightApprovedNonVideoAssets(approvedInput({
      opportunityType: "SCRIPTURE_GRAPHIC",
      approvedContent: "The Lord is my shepherd.",
      relatedScripture: "Psalm 23:1",
      scriptureTranslation: null,
      scriptureAccuracyConfirmed: true,
    }));
    const unconfirmed = preflightApprovedNonVideoAssets(approvedInput({
      opportunityType: "SCRIPTURE_GRAPHIC",
      approvedContent: "The Lord is my shepherd.",
      relatedScripture: "Psalm 23:1",
      scriptureTranslation: "NIV",
      scriptureAccuracyConfirmed: false,
    }));
    const ready = preflightApprovedNonVideoAssets(approvedInput({
      opportunityType: "SCRIPTURE_GRAPHIC",
      approvedContent: "The Lord is my shepherd.",
      relatedScripture: "Psalm 23:1",
      scriptureTranslation: "NIV",
      scriptureAccuracyConfirmed: true,
    }));

    expect(missingVersion.diagnostics).toContainEqual(expect.objectContaining({
      code: "SCRIPTURE_REFERENCE_INVALID",
      blocking: true,
    }));
    expect(unconfirmed.diagnostics).toContainEqual(expect.objectContaining({
      code: "SCRIPTURE_ACCURACY_UNCONFIRMED",
      blocking: true,
    }));
    expect(ready.ready).toBe(true);
    expect(ready.plannedFiles.every((file) => file.scripture?.endsWith(" NIV"))).toBe(true);
    expect(resolveRenderedScriptureReference({
      relatedScripture: "John 3:16 NLT",
      scriptureTranslation: "NIV",
    })).toBe("John 3:16 NIV");
  });

  it("rejects unsafe IDs before constructing a storage path", () => {
    const input = approvedInput({ opportunityId: "../escape" });
    expect(preflightApprovedNonVideoAssets(input).diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "INVALID_IDENTIFIER", blocking: true }),
    ]));
    expect(() => getNonVideoAssetOutputDirectory(input.sermonId, input.opportunityId)).toThrow(
      "Invalid sermon or content opportunity ID",
    );
  });
});
