import { timingSafeEqual } from "node:crypto";
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_COOKIE_FILE_BYTES = 5 * 1024 * 1024;
const COOKIE_FILE_PATH = process.env.YOUTUBE_COOKIE_FILE_PATH?.trim()
  || "/srv/sermon-clip/private/youtube-cookies.txt";

function hasValidSetupToken(request: Request): boolean {
  const expected = process.env.YOUTUBE_COOKIE_UPLOAD_TOKEN?.trim();
  const supplied = new URL(request.url).searchParams.get("token")?.trim();

  if (!expected || !supplied) return false;

  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

function page(message?: string, isError = false): NextResponse {
  const messageHtml = message
    ? `<p role="status" class="${isError ? "error" : "success"}">${message}</p>`
    : "";

  return new NextResponse(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Secure YouTube access setup</title>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 42rem; margin: 4rem auto; padding: 0 1.25rem; color: #172033; }
      form { display: grid; gap: 1rem; padding: 1.5rem; border: 1px solid #d6dbe8; border-radius: .75rem; }
      button { width: fit-content; padding: .65rem 1rem; border: 0; border-radius: .5rem; background: #155eef; color: white; font-weight: 700; }
      .success { color: #087443; } .error { color: #b42318; }
    </style>
  </head>
  <body>
    <h1>Secure YouTube access setup</h1>
    <p>Upload the <code>youtube-cookies.txt</code> file created on this Mac. It is stored only on this server for video downloads and cannot be downloaded from this page.</p>
    ${messageHtml}
    <form method="post" enctype="multipart/form-data">
      <label>Cookie file <input required type="file" name="cookieFile" accept=".txt,text/plain" /></label>
      <button type="submit">Store secure cookie file</button>
    </form>
  </body>
</html>`, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}

export async function GET(request: Request) {
  return hasValidSetupToken(request) ? page() : new NextResponse(null, { status: 404 });
}

export async function POST(request: Request) {
  if (!hasValidSetupToken(request)) return new NextResponse(null, { status: 404 });

  const data = await request.formData();
  const file = data.get("cookieFile");
  if (!(file instanceof File)) return page("Choose the cookie file first.", true);
  if (file.size === 0 || file.size > MAX_COOKIE_FILE_BYTES) {
    return page("The file is missing or is too large.", true);
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const firstLine = bytes.subarray(0, Math.min(bytes.length, 128)).toString("utf8").split(/\r?\n/, 1)[0];
  if (firstLine !== "# Netscape HTTP Cookie File" && firstLine !== "# HTTP Cookie File") {
    return page("This is not a Netscape-format cookie file.", true);
  }

  const directory = path.dirname(COOKIE_FILE_PATH);
  const temporaryPath = `${COOKIE_FILE_PATH}.uploading`;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(temporaryPath, bytes, { mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, COOKIE_FILE_PATH);
  await chmod(COOKIE_FILE_PATH, 0o600);

  return page("Cookie file stored securely. You can close this page.");
}
