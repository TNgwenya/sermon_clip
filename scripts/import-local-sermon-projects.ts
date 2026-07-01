import { readdir, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { prisma } from "../src/lib/prisma.ts";
import { getStorageRoot } from "../src/server/agents/storage.ts";

type LocalProject = {
  id: string;
  folderName: string;
  title: string;
  youtubeUrl: string;
};

const execFileAsync = promisify(execFile);

type TranscriptCache = {
  provider?: string;
  language?: string;
  fullText?: string;
  segmentCount?: number;
};

type ChunkTranscriptCache = {
  transcript?: {
    segments?: Array<{
      startTimeSeconds?: number;
      endTimeSeconds?: number;
      text?: string;
    }>;
  };
};

const PROJECTS: LocalProject[] = [
  {
    id: "cmqsd0lg200008oxwyad1dle7",
    folderName: "find-yourself-in-the-will-of-god",
    title: "Find Yourself in the Will of God",
    youtubeUrl: "https://www.youtube.com/watch?v=7O4OTLJU4uY",
  },
  {
    id: "cmqti6nrl00vf8oxwaf6xmtyf",
    folderName: "leadership-and-trust",
    title: "Leadership and Trust",
    youtubeUrl: "local-upload://leadership-and-trust/source.mp4",
  },
  {
    id: "cmquv59a9001gxitbrl0uyhvj",
    folderName: "13-07-2025-sermon-broadcast",
    title: "13-07-2025 Sermon Broadcast",
    youtubeUrl: "https://www.youtube.com/watch?v=WLXo5J24cyE",
  },
];

function projectRoot(project: LocalProject): string {
  return path.join(getStorageRoot(), "sermons", project.folderName);
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const file = await import("node:fs/promises").then((fs) => fs.readFile(filePath, "utf8"));
    return JSON.parse(file) as T;
  } catch {
    return null;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile() && fileStat.size > 0;
  } catch {
    return false;
  }
}

async function sourceDurationSeconds(sourceVideoPath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      sourceVideoPath,
    ]);
    const duration = Number(stdout.trim());
    return Number.isFinite(duration) && duration > 0 ? duration : null;
  } catch {
    return null;
  }
}

async function readSegments(project: LocalProject): Promise<Array<{ startTimeSeconds: number; endTimeSeconds: number; text: string }>> {
  const chunkFolder = path.join(projectRoot(project), "transcript", "chunk-transcripts");
  const chunkFiles = (await readdir(chunkFolder).catch(() => []))
    .filter((fileName) => fileName.endsWith(".transcript.json"))
    .sort();

  let offset = 0;
  const segments: Array<{ startTimeSeconds: number; endTimeSeconds: number; text: string }> = [];
  for (const chunkFile of chunkFiles) {
    const cache = await readJson<ChunkTranscriptCache>(path.join(chunkFolder, chunkFile));
    const chunkSegments = cache?.transcript?.segments ?? [];
    for (const segment of chunkSegments) {
      if (
        typeof segment.startTimeSeconds !== "number"
        || typeof segment.endTimeSeconds !== "number"
        || typeof segment.text !== "string"
        || !segment.text.trim()
      ) {
        continue;
      }

      segments.push({
        startTimeSeconds: offset + segment.startTimeSeconds,
        endTimeSeconds: offset + segment.endTimeSeconds,
        text: segment.text.trim(),
      });
    }

    const lastSegment = chunkSegments.at(-1);
    if (typeof lastSegment?.endTimeSeconds === "number") {
      offset += lastSegment.endTimeSeconds;
    }
  }

  return segments;
}

async function renderedClipFiles(project: LocalProject): Promise<string[]> {
  const renderedFolder = path.join(projectRoot(project), "clips", "rendered");
  return (await readdir(renderedFolder).catch(() => []))
    .filter((fileName) => fileName.endsWith(".mp4"))
    .sort();
}

async function importProject(project: LocalProject): Promise<Record<string, unknown>> {
  const root = projectRoot(project);
  const sourceVideoPath = path.join(root, "source", "source.mp4");
  const audioPath = path.join(root, "audio", "audio.mp3");
  const transcriptJsonPath = path.join(root, "transcript", "transcript.json");
  const transcriptCache = await readJson<TranscriptCache>(transcriptJsonPath);
  const fullText = transcriptCache?.fullText?.trim() ?? "";
  const language = transcriptCache?.language ?? "english";
  const segments = await readSegments(project);
  const renderedFiles = await renderedClipFiles(project);
  const durationSeconds = await sourceDurationSeconds(sourceVideoPath);

  const existing = await prisma.sermon.findUnique({
    where: { id: project.id },
    select: { id: true, title: true },
  });

  if (existing) {
    return { id: project.id, title: existing.title, created: false, reason: "already exists" };
  }

  await prisma.$transaction(async (tx) => {
    await tx.sermon.create({
      data: {
        id: project.id,
        youtubeUrl: project.youtubeUrl,
        title: project.title,
        speakerName: "Unknown speaker",
        churchName: "Melusi",
        language,
        sourceDurationSeconds: durationSeconds,
        status: renderedFiles.length > 0 ? "CLIPS_GENERATED" : "TRANSCRIBED",
        rightsConfirmed: true,
        sourceVideoPath: await fileExists(sourceVideoPath) ? sourceVideoPath : null,
        audioPath: await fileExists(audioPath) ? audioPath : null,
        transcriptJsonPath: await fileExists(transcriptJsonPath) ? transcriptJsonPath : null,
      },
    });

    if (fullText) {
      const transcript = await tx.transcript.create({
        data: {
          sermonId: project.id,
          fullText,
          provider: transcriptCache?.provider ?? "openai",
          language,
          rawJsonPath: transcriptJsonPath,
        },
      });

      if (segments.length > 0) {
        await tx.transcriptSegment.createMany({
          data: segments.map((segment) => ({
            sermonId: project.id,
            transcriptId: transcript.id,
            startTimeSeconds: segment.startTimeSeconds,
            endTimeSeconds: segment.endTimeSeconds,
            text: segment.text,
          })),
        });
      }
    }

    if (renderedFiles.length > 0) {
      await tx.clipCandidate.createMany({
        data: renderedFiles.map((fileName, index) => {
          const clipId = path.basename(fileName, ".mp4");
          const renderedFilePath = path.join(root, "clips", "rendered", fileName);
          const thumbnailPath = path.join(root, "clips", "thumbnails", `${clipId}.jpg`);
          const captionedVideoPath = path.join(root, "clips", "captioned", `${clipId}.captioned.mp4`);
          const overlayVideoPath = path.join(root, "clips", "overlay", `${clipId}.overlay.mp4`);
          const srtPath = path.join(root, "clips", "subtitles", `${clipId}.srt`);

          return {
            id: clipId,
            sermonId: project.id,
            isAiGenerated: false,
            startTimeSeconds: 0,
            endTimeSeconds: 60,
            durationSeconds: 60,
            renderedFilePath,
            renderStatus: "COMPLETED" as const,
            thumbnailPath,
            transcriptText: fullText.slice(0, 1000) || "Imported local rendered clip.",
            title: `${project.title} clip ${index + 1}`,
            hook: project.title,
            caption: "",
            hashtags: [],
            score: 0.5,
            reasonSelected: "Imported from local project storage.",
            clipType: "imported",
            riskLevel: "LOW" as const,
            riskReasons: [],
            status: "SUGGESTED" as const,
            srtPath,
            subtitleFilePath: srtPath,
            subtitlesGenerated: true,
            captionStatus: "GENERATED" as const,
            captionBurnStatus: "COMPLETED" as const,
            captionedVideoPath,
            overlayStatus: "COMPLETED" as const,
            overlayVideoPath,
            renderFreshness: "UP_TO_DATE" as const,
            captionFreshness: "UP_TO_DATE" as const,
            captionBurnFreshness: "UP_TO_DATE" as const,
            overlayFreshness: "UP_TO_DATE" as const,
          };
        }),
        skipDuplicates: true,
      });
    }
  });

  return {
    id: project.id,
    title: project.title,
    created: true,
    transcriptSegments: segments.length,
    importedClips: renderedFiles.length,
  };
}

async function main(): Promise<void> {
  const results = [];
  for (const project of PROJECTS) {
    results.push(await importProject(project));
  }

  console.log(JSON.stringify({ imported: results }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
