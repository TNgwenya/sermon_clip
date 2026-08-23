import crypto from "node:crypto";

type CloudflareLiveInput = {
  uid: string;
  rtmps?: { url?: string; streamKey?: string };
  rtmp?: { url?: string; streamKey?: string };
};

type CloudflareVideo = {
  uid?: string;
  duration?: number;
  created?: string;
  meta?: { name?: string };
  status?: { state?: string; errorReasonText?: string };
};

type CloudflareDownload = {
  status?: "ready" | "inprogress" | "error";
  url?: string;
};

type CloudflareApiResponse<T> = {
  success?: boolean;
  errors?: Array<{ message?: string }>;
  result?: T;
};

export type ReadyCloudflareRecording = {
  providerRecordingId: string;
  title: string;
  durationSeconds: number;
  createdAt?: string;
};

export type CloudflareMp4Preparation =
  | { state: "ready"; downloadUrl: string }
  | { state: "pending" }
  | { state: "failed"; reason: string };

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function cloudflareUrl(path: string): string {
  const accountId = required("CLOUDFLARE_ACCOUNT_ID");
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/${path.replace(/^\/+/, "")}`;
}

function cloudflareHeaders(): HeadersInit {
  return { Authorization: `Bearer ${required("CLOUDFLARE_STREAM_API_TOKEN")}` };
}

function cloudflareError<T>(response: Response, payload: CloudflareApiResponse<T>, fallback: string): Error {
  return new Error(payload.errors?.[0]?.message || `${fallback} (HTTP ${response.status}).`);
}

export function liveIntakeProviderReady(): boolean {
  return Boolean(process.env.CLOUDFLARE_ACCOUNT_ID?.trim() && process.env.CLOUDFLARE_STREAM_API_TOKEN?.trim());
}

export async function createCloudflareLiveInput(label: string): Promise<{ providerInputId: string; ingestUrl: string; streamKey: string }> {
  const accountId = required("CLOUDFLARE_ACCOUNT_ID");
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/live_inputs`, {
    method: "POST",
    headers: { ...cloudflareHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ meta: { name: label }, recording: { mode: "automatic" } }),
    cache: "no-store",
  });
  const payload = await response.json() as { success?: boolean; errors?: Array<{ message?: string }>; result?: CloudflareLiveInput };
  const input = payload.result;
  const endpoint = input?.rtmps ?? input?.rtmp;
  if (!response.ok || !payload.success || !input?.uid || !endpoint?.url || !endpoint.streamKey) {
    throw new Error(payload.errors?.[0]?.message || "Cloudflare could not create the private live input.");
  }
  return { providerInputId: input.uid, ingestUrl: endpoint.url, streamKey: endpoint.streamKey };
}

/**
 * Cloudflare's live notifications report connection state, not a completed
 * recording identifier. The trusted worker therefore polls this authenticated
 * endpoint after a disconnect and only accepts ready recordings.
 */
export async function listReadyCloudflareRecordings(providerInputId: string): Promise<ReadyCloudflareRecording[]> {
  const inputId = providerInputId.trim();
  if (!inputId) throw new Error("Cloudflare live input ID is required.");
  const response = await fetch(cloudflareUrl(`live_inputs/${encodeURIComponent(inputId)}/videos`), {
    headers: cloudflareHeaders(),
    cache: "no-store",
  });
  const payload = await response.json() as CloudflareApiResponse<CloudflareVideo[]>;
  if (!response.ok || !payload.success || !Array.isArray(payload.result)) {
    throw cloudflareError(response, payload, "Cloudflare could not list live recordings");
  }
  return payload.result.flatMap((video) => {
    const durationSeconds = Math.floor(Number(video.duration));
    if (
      video.status?.state !== "ready"
      || !video.uid
      || !Number.isSafeInteger(durationSeconds)
      || durationSeconds <= 0
    ) return [];
    return [{
      providerRecordingId: video.uid,
      title: video.meta?.name?.trim().slice(0, 180) || "Sunday live recording",
      durationSeconds,
      createdAt: video.created,
    }];
  });
}

/**
 * Requests Cloudflare's server-side MP4 only after a recording is ready. The
 * caller must treat the returned URL as ephemeral and copy it directly into
 * tenant-owned private storage; it must never be exposed to a browser.
 */
export async function prepareCloudflareRecordingMp4(providerRecordingId: string): Promise<CloudflareMp4Preparation> {
  const recordingId = providerRecordingId.trim();
  if (!recordingId) throw new Error("Cloudflare recording ID is required.");
  const response = await fetch(cloudflareUrl(`${encodeURIComponent(recordingId)}/downloads`), {
    method: "POST",
    headers: cloudflareHeaders(),
    cache: "no-store",
  });
  const payload = await response.json() as CloudflareApiResponse<{ default?: CloudflareDownload }>;
  if (!response.ok || !payload.success) {
    throw cloudflareError(response, payload, "Cloudflare could not prepare the recording download");
  }
  const download = payload.result?.default;
  if (download?.status === "ready" && download.url) return { state: "ready", downloadUrl: download.url };
  if (download?.status === "error") return { state: "failed", reason: "Cloudflare could not create an MP4 for this recording." };
  return { state: "pending" };
}

export function verifyLiveWebhook(request: Request, body: string): boolean {
  const secret = process.env.LIVE_INTAKE_WEBHOOK_SECRET?.trim();
  if (!secret) return false;
  const supplied = request.headers.get("x-sermonclip-live-signature")?.trim();
  if (!supplied) return false;
  const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  return suppliedBytes.length === expectedBytes.length && crypto.timingSafeEqual(suppliedBytes, expectedBytes);
}
