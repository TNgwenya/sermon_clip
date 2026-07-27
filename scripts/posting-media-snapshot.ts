import { constants as fsConstants, createReadStream } from "node:fs";
import { copyFile, mkdtemp, rm, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

export type PostingMediaSnapshot = {
  filePath: string;
  sizeBytes: number;
  sha256: string;
  remove(): Promise<void>;
};

function cleanPathSegment(value: string): string {
  const cleaned = value.trim().replace(/[^A-Za-z0-9._-]/g, "-").replace(/-+/g, "-");
  if (!cleaned) {
    throw new Error("Cannot snapshot posting media with an empty composition identifier.");
  }

  return cleaned;
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const input = createReadStream(filePath);
    input.on("data", (chunk) => hash.update(chunk));
    input.once("error", reject);
    input.once("end", resolve);
  });
  return hash.digest("hex");
}

export async function createPostingMediaSnapshot(input: {
  sourcePath: string;
  clipId: string;
  editPlanId: string;
  artifactId: string;
  planHash: string;
  expectedSizeBytes?: number | null;
}): Promise<PostingMediaSnapshot> {
  const sourceStat = await stat(input.sourcePath);
  if (!sourceStat.isFile() || sourceStat.size <= 0) {
    throw new Error("The claimed clip export is not a readable non-empty file.");
  }
  if (input.expectedSizeBytes && sourceStat.size !== input.expectedSizeBytes) {
    throw new Error("The claimed clip export size no longer matches its ready artifact.");
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "sermon-clip-posting-"));
  const extension = path.extname(input.sourcePath) || ".mp4";
  const filename = [
    cleanPathSegment(input.clipId),
    cleanPathSegment(input.editPlanId),
    cleanPathSegment(input.artifactId),
    cleanPathSegment(input.planHash),
  ].join(".");
  const snapshotPath = path.join(tempDir, `${filename}${extension}`);

  try {
    await copyFile(input.sourcePath, snapshotPath, fsConstants.COPYFILE_EXCL);
    const snapshotStat = await stat(snapshotPath);
    if (!snapshotStat.isFile() || snapshotStat.size !== sourceStat.size) {
      throw new Error("The posting snapshot does not match the claimed clip export size.");
    }
    const sha256 = await sha256File(snapshotPath);

    return {
      filePath: snapshotPath,
      sizeBytes: snapshotStat.size,
      sha256,
      remove: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}
