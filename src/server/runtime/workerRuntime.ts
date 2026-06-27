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

export function localMediaProcessingUnavailableMessage(action: string): string {
  return `${action} was queued or saved, but media processing must run on your local worker because this deployment cannot run ffmpeg/sharp jobs.`;
}
