import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { prisma } from "@/lib/prisma";
import { getSermonStoragePath } from "@/server/agents/storage";
import { getBrandingSettings } from "@/server/branding/settings";

const execFileAsync = promisify(execFile);
const PDF_ELIGIBLE_TYPES = new Set(["DEVOTIONAL", "PRAYER", "DISCUSSION", "GUIDE", "SERMON_RECAP"]);
const guidePdfGenerations = new Map<string, Promise<GeneratedGuidePdf>>();

export type GeneratedGuidePdf = {
  path: string;
  fileName: string;
  sizeBytes: number;
};

function resolvePythonPath(): string {
  const configured = process.env.PYTHON_BIN?.trim();
  if (configured) return configured;

  // Codex Desktop bundles the document runtime used by this local-first app.
  // Outside Codex, deployments can point PYTHON_BIN at any Python environment
  // with requirements-pdf.txt installed.
  const bundled = path.join(
    os.homedir(),
    ".cache",
    "codex-runtimes",
    "codex-primary-runtime",
    "dependencies",
    "python",
    "bin",
    "python3",
  );
  return existsSync(bundled) ? bundled : "python3";
}

export function getGuidePdfOutputPath(sermonId: string, assetId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(sermonId) || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(assetId)) {
    throw new Error("Invalid content asset identifier for PDF storage.");
  }
  return path.join(getSermonStoragePath(sermonId), "content-assets", assetId, "ministry-guide.pdf");
}

function buildGuidePdfWorkingPaths(outputPath: string): { inputPath: string; stagedOutputPath: string } {
  const requestId = randomUUID();
  const workingDirectory = path.dirname(outputPath);
  return {
    inputPath: path.join(workingDirectory, `.ministry-guide-${requestId}.json`),
    stagedOutputPath: path.join(workingDirectory, `.ministry-guide-${requestId}.pdf`),
  };
}

async function generateContentAssetGuidePdfOnce(assetId: string): Promise<GeneratedGuidePdf> {
  const asset = await prisma.contentAsset.findUnique({
    where: { id: assetId },
    select: {
      id: true,
      sermonId: true,
      assetType: true,
      status: true,
      title: true,
      bodyContent: true,
      contentOpportunity: { select: { relatedScripture: true, shortDescription: true } },
    },
  });
  if (!asset || asset.status === "GENERATED" || asset.status === "ARCHIVED") {
    throw new Error("Approve and prepare this guide before creating its PDF.");
  }
  if (!PDF_ELIGIBLE_TYPES.has(asset.assetType)) {
    throw new Error("This content type is not a ministry-guide PDF.");
  }

  const branding = await getBrandingSettings();
  const outputPath = getGuidePdfOutputPath(asset.sermonId, asset.id);
  const workingDirectory = path.dirname(outputPath);
  const { inputPath, stagedOutputPath } = buildGuidePdfWorkingPaths(outputPath);
  await mkdir(workingDirectory, { recursive: true });
  await writeFile(inputPath, JSON.stringify({
    churchName: branding.churchName,
    primaryColor: branding.primaryBrandColor,
    secondaryColor: branding.secondaryBrandColor,
    title: asset.title,
    subtitle: asset.contentOpportunity?.shortDescription ?? "A sermon-grounded ministry resource",
    scripture: asset.contentOpportunity?.relatedScripture ?? "",
    bodyContent: asset.bodyContent ?? "",
  }), "utf8");

  const scriptPath = path.join(process.cwd(), "scripts", "render-content-guide-pdf.py");
  try {
    await execFileAsync(resolvePythonPath(), [scriptPath, inputPath, stagedOutputPath], { timeout: 60_000 });
    // Staging in the destination directory keeps finalization on one
    // filesystem. Readers therefore see either the previous complete PDF or
    // this complete PDF, never a partially rendered file.
    await rename(stagedOutputPath, outputPath);
  } finally {
    await unlink(inputPath).catch(() => undefined);
    await unlink(stagedOutputPath).catch(() => undefined);
  }
  const fileStat = await stat(outputPath);
  return { path: outputPath, fileName: `${asset.title.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "ministry-guide"}.pdf`, sizeBytes: fileStat.size };
}

export function generateContentAssetGuidePdf(assetId: string): Promise<GeneratedGuidePdf> {
  const activeGeneration = guidePdfGenerations.get(assetId);
  if (activeGeneration) return activeGeneration;

  const generation = generateContentAssetGuidePdfOnce(assetId).finally(() => {
    if (guidePdfGenerations.get(assetId) === generation) {
      guidePdfGenerations.delete(assetId);
    }
  });
  guidePdfGenerations.set(assetId, generation);
  return generation;
}

export const __guidePdfServiceTestUtils = {
  PDF_ELIGIBLE_TYPES,
  buildGuidePdfWorkingPaths,
};
