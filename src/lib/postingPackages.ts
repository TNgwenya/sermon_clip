import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type PostingPackageHistoryItem = {
  id: string;
  clipIds: string[];
  clipTitles: string[];
  sermonTitle: string;
  churchName: string;
  fileName: string;
  clipCount: number;
  totalVideoBytes: number;
  createdAt: string;
};

function packageHistoryPath(): string {
  return process.env.POSTING_PACKAGE_HISTORY_PATH || path.join(/*turbopackIgnore: true*/ process.cwd(), "storage", "posting-packages.json");
}

function isPostingPackageHistoryItem(value: unknown): value is PostingPackageHistoryItem {
  if (!value || typeof value !== "object") {
    return false;
  }

  const item = value as PostingPackageHistoryItem;
  return (
    typeof item.id === "string"
    && Array.isArray(item.clipIds)
    && Array.isArray(item.clipTitles)
    && typeof item.sermonTitle === "string"
    && typeof item.churchName === "string"
    && typeof item.fileName === "string"
    && typeof item.clipCount === "number"
    && typeof item.totalVideoBytes === "number"
    && typeof item.createdAt === "string"
  );
}

async function readPackageHistoryStore(): Promise<PostingPackageHistoryItem[]> {
  try {
    const file = await readFile(/* turbopackIgnore: true */ packageHistoryPath(), "utf8");
    const parsed = JSON.parse(file);
    return Array.isArray(parsed) ? parsed.filter(isPostingPackageHistoryItem) : [];
  } catch {
    return [];
  }
}

async function writePackageHistoryStore(items: PostingPackageHistoryItem[]): Promise<void> {
  const storePath = packageHistoryPath();
  await mkdir(/* turbopackIgnore: true */ path.dirname(storePath), { recursive: true });
  await writeFile(/* turbopackIgnore: true */ storePath, JSON.stringify(items, null, 2));
}

export async function listPostingPackageHistory(): Promise<PostingPackageHistoryItem[]> {
  const items = await readPackageHistoryStore();
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function prunePostingPackageHistoryByClipIds(clipIds: string[]): Promise<number> {
  const clipIdSet = new Set(clipIds.map((clipId) => clipId.trim()).filter(Boolean));
  if (clipIdSet.size === 0) {
    return 0;
  }

  const items = await readPackageHistoryStore();
  const retained = items.filter((item) => !item.clipIds.some((clipId) => clipIdSet.has(clipId)));
  if (retained.length === items.length) {
    return 0;
  }

  await writePackageHistoryStore(retained);
  return items.length - retained.length;
}

export function buildPostingPackageDownloadHref(clipIds: string[]): string {
  const normalized = Array.from(new Set(clipIds.map((clipId) => clipId.trim()).filter(Boolean)));
  if (normalized.length === 0) {
    return "/api/ready-to-post/download?clipIds=all";
  }

  return `/api/ready-to-post/download?clipIds=${encodeURIComponent(normalized.join(","))}`;
}

export async function recordPostingPackage(input: {
  clipIds: string[];
  clipTitles: string[];
  sermonTitle: string;
  churchName: string;
  fileName: string;
  totalVideoBytes: number;
}): Promise<PostingPackageHistoryItem> {
  const item: PostingPackageHistoryItem = {
    id: `package-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    clipIds: input.clipIds,
    clipTitles: input.clipTitles,
    sermonTitle: input.sermonTitle,
    churchName: input.churchName,
    fileName: input.fileName,
    clipCount: input.clipIds.length,
    totalVideoBytes: input.totalVideoBytes,
    createdAt: new Date().toISOString(),
  };

  const items = await readPackageHistoryStore();
  await writePackageHistoryStore([item, ...items].slice(0, 100));
  return item;
}
