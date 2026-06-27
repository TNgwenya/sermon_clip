import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

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

function streamFile(filePath: string, start?: number, end?: number): BodyInit {
  const fileStream = createReadStream(filePath, { start, end });
  let streamSettled = false;
  let streamCanceled = false;

  const isInvalidStateError = (error: unknown): boolean => {
    if (!(error instanceof Error)) {
      return false;
    }

    return (error as Error & { code?: unknown }).code === "ERR_INVALID_STATE";
  };

  const settleStream = () => {
    streamSettled = true;
    fileStream.removeAllListeners("data");
    fileStream.removeAllListeners("end");
    fileStream.removeAllListeners("close");
    fileStream.removeAllListeners("error");
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const closeController = () => {
        if (streamSettled || streamCanceled) {
          return;
        }

        settleStream();

        try {
          controller.close();
        } catch (error) {
          if (!isInvalidStateError(error)) {
            throw error;
          }
        }
      };

      const errorController = (error: unknown) => {
        if (streamSettled || streamCanceled) {
          return;
        }

        settleStream();

        try {
          controller.error(error);
        } catch (controllerError) {
          if (!isInvalidStateError(controllerError)) {
            throw controllerError;
          }
        }
      };

      fileStream.on("data", (chunk) => {
        if (streamSettled || streamCanceled) {
          return;
        }

        const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;

        try {
          controller.enqueue(new Uint8Array(bytes));
        } catch (error) {
          if (isInvalidStateError(error)) {
            streamCanceled = true;
            settleStream();
            fileStream.destroy();
            return;
          }

          throw error;
        }
      });

      fileStream.once("end", closeController);
      fileStream.once("close", closeController);
      fileStream.once("error", errorController);
    },
    cancel() {
      streamCanceled = true;
      settleStream();
      fileStream.destroy();
    },
  });
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

  if (fileSize <= 0) {
    return NextResponse.json(
      { error: "The prepared video file is empty. Recreate the download before posting this clip." },
      { status: 409 },
    );
  }

  const range = request.headers.get("range");
  const baseHeaders = {
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "Content-Disposition": contentDisposition(disposition, filePath, downloadFileName),
    "Content-Type": "video/mp4",
  };

  if (!range) {
    return new NextResponse(streamFile(filePath), {
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
