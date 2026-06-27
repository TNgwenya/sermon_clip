export function isVercelRuntime(): boolean {
  return Boolean(process.env.VERCEL);
}

export function canRunLocalMediaProcessing(): boolean {
  if (isVercelRuntime()) {
    return false;
  }

  return process.env.WORKER_ENABLED === "true" || !isVercelRuntime();
}

export function localMediaProcessingUnavailableMessage(action: string): string {
  return `${action} was queued or saved, but media processing must run on your local worker because this deployment cannot run ffmpeg/sharp jobs.`;
}
