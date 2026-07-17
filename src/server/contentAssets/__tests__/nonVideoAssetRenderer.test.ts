import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  getNonVideoAssetOutputDirectory,
  preflightApprovedNonVideoAssets,
  renderApprovedNonVideoAssets,
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
