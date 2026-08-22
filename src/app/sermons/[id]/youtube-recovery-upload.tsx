"use client";

import { RetryFailedJobButton } from "@/app/sermons/[id]/retry-failed-job-button";

/**
 * The normal recovery experience for a YouTube URL. This deliberately keeps
 * media on the server-side path: people using a phone should never need a
 * local video copy merely because YouTube temporarily asks us to verify.
 *
 * Do not add a browser-cookie or password collection flow here. A future
 * provider-authorisation flow must use a documented provider-supported source
 * access mechanism and be separately security reviewed.
 */
export function YouTubeServerRecovery({
  sermonId,
  jobId,
}: {
  sermonId: string;
  jobId: string;
}) {
  return (
    <section
      id="youtube-server-recovery"
      className="youtube-recovery-fallback"
      aria-labelledby="youtube-server-recovery-title"
    >
      <div className="youtube-recovery-heading stack-sm">
        <p className="kicker">YouTube import</p>
        <h2 id="youtube-server-recovery-title">Sermon Clip will keep this import on the server</h2>
        <p className="muted">
          YouTube temporarily asked the worker to verify this link. Your sermon details are safe. No one needs to download the video to a phone or upload a replacement file.
        </p>
      </div>
      <div className="youtube-recovery-actions stack-sm">
        {jobId ? <RetryFailedJobButton sermonId={sermonId} jobId={jobId} /> : null}
        <p className="muted small">
          A retry uses the same YouTube URL and secure worker. Sermon Clip does not ask for a YouTube password or copy browser cookies from a device.
        </p>
      </div>
    </section>
  );
}
