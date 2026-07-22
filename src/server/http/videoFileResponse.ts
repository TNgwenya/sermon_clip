import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { Stats } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

import { NextResponse } from "next/server";

type VideoDisposition = "inline" | "attachment";

type VideoFileResponseOptions = {
  request: Request;
  filePath: string;
  disposition: VideoDisposition;
  downloadFileName?: string;
};

function contentDisposition(disposition: VideoDisposition, filePath: string, downloadFileName?: string): string {
  const fileName = (downloadFileName?.trim() || path.basename(filePath)).replace(/"/g, "");
  return `${disposition}; filename="${fileName}"`;
}

function buildEntityTag(fileStat: Stats): string {
  return `"${fileStat.size.toString(16)}-${Math.trunc(fileStat.mtimeMs).toString(16)}"`;
}

function headerMatchesEntityTag(header: string | null, entityTag: string): boolean {
  if (!header) {
    return false;
  }

  return header
    .split(",")
    .map((tag) => tag.trim())
    .some((tag) => tag === "*" || tag === entityTag);
}

function headerMatchesModifiedTime(header: string | null, modifiedTime: Date): boolean {
  if (!header) {
    return false;
  }

  const requestTime = Date.parse(header);
  if (Number.isNaN(requestTime)) {
    return false;
  }

  return Math.floor(modifiedTime.getTime() / 1000) <= Math.floor(requestTime / 1000);
}

function requestHasFreshInlineCache(request: Request, entityTag: string, modifiedTime: Date): boolean {
  const ifNoneMatch = request.headers.get("if-none-match");
  if (ifNoneMatch !== null) {
    return headerMatchesEntityTag(ifNoneMatch, entityTag);
  }

  return headerMatchesModifiedTime(request.headers.get("if-modified-since"), modifiedTime);
}

function requestAllowsRange(request: Request, entityTag: string, modifiedTime: Date): boolean {
  const ifRange = request.headers.get("if-range")?.trim();
  if (!ifRange) {
    return true;
  }

  if (ifRange.startsWith("\"") || ifRange.startsWith("W/\"")) {
    return !ifRange.startsWith("W/") && ifRange === entityTag;
  }

  return headerMatchesModifiedTime(ifRange, modifiedTime);
}

function streamFile(filePath: string, start?: number, end?: number): BodyInit {
  const fileStream = createReadStream(filePath, { start, end });
  return Readable.toWeb(fileStream) as unknown as BodyInit;
}

export function resolveByteRange(rangeHeader: string, fileSize: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match || fileSize <= 0) {
    return null;
  }

  const startText = match[1];
  const endText = match[2];

  if (!startText && !endText) {
    return null;
  }

  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return null;
    }

    return {
      start: Math.max(0, fileSize - suffixLength),
      end: fileSize - 1,
    };
  }

  const start = Number(startText);
  const end = endText ? Number(endText) : fileSize - 1;

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= fileSize) {
    return null;
  }

  return {
    start,
    end: Math.min(end, fileSize - 1),
  };
}

export async function videoFileResponse({
  request,
  filePath,
  disposition,
  downloadFileName,
}: VideoFileResponseOptions): Promise<NextResponse> {
  const fileStat = await stat(filePath);
  const fileSize = fileStat.size;
  const entityTag = buildEntityTag(fileStat);
  const lastModified = fileStat.mtime.toUTCString();
  const isHeadRequest = request.method.toUpperCase() === "HEAD";

  if (fileSize <= 0) {
    return NextResponse.json(
      { error: "The prepared video file is empty. Recreate the download before posting this clip." },
      { status: 409 },
    );
  }

  const requestedRange = isHeadRequest ? null : request.headers.get("range");
  const range = requestedRange && requestAllowsRange(request, entityTag, fileStat.mtime)
    ? requestedRange
    : null;
  const baseHeaders = {
    "Accept-Ranges": "bytes",
    "Cache-Control": disposition === "inline" ? "private, max-age=0, must-revalidate" : "no-store",
    "Content-Disposition": contentDisposition(disposition, filePath, downloadFileName),
    "ETag": entityTag,
    "Last-Modified": lastModified,
    "Content-Type": "video/mp4",
  };

  if (disposition === "inline" && requestHasFreshInlineCache(request, entityTag, fileStat.mtime)) {
    return new NextResponse(null, {
      status: 304,
      headers: baseHeaders,
    });
  }

  if (!range) {
    return new NextResponse(isHeadRequest ? null : streamFile(filePath), {
      status: 200,
      headers: {
        ...baseHeaders,
        "Content-Length": String(fileSize),
      },
    });
  }

  const byteRange = resolveByteRange(range, fileSize);
  if (!byteRange) {
    return new NextResponse(null, {
      status: 416,
      headers: {
        ...baseHeaders,
        "Content-Range": `bytes */${fileSize}`,
      },
    });
  }

  const { start, end } = byteRange;

  return new NextResponse(streamFile(filePath, start, end), {
    status: 206,
    headers: {
      ...baseHeaders,
      "Content-Length": String(end - start + 1),
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
    },
  });
}
