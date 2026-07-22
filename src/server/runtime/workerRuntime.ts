export function isVercelRuntime(): boolean {
  return Boolean(process.env.VERCEL);
}

export function isControlPanelRuntime(): boolean {
  return isVercelRuntime() || process.env.CONTROL_PANEL_MODE === "true";
}

export function canRunLocalMediaProcessing(): boolean {
  if (isControlPanelRuntime()) {
    return false;
  }

  return process.env.WORKER_ENABLED === "true" || !isControlPanelRuntime();
}

/**
 * Heavy media work must never run inside a production Next.js web process.
 *
 * A self-hosted deployment can still have local media storage (and therefore
 * return true from canRunLocalMediaProcessing) while delegating ffmpeg, sharp,
 * and TensorFlow work to its persistent media worker. The worker marks its own
 * runtime with a process-only marker before loading application modules. Development
 * stays inline so the local app remains easy to run without a second process.
 */
export function canRunInlineMediaProcessing(): boolean {
  if (!canRunLocalMediaProcessing()) {
    return false;
  }

  return process.env.MEDIA_WORKER_RUNTIME === "true" || process.env.NODE_ENV !== "production";
}

export function localMediaProcessingUnavailableMessage(action: string): string {
  return `${action} was queued or saved, but media processing must run on your local worker because this deployment cannot run ffmpeg/sharp jobs.`;
}
