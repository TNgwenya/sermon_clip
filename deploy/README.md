# EC2 worker deployment

This folder defines the service layer for the dedicated Sermon Clip pilot worker. It deliberately does not contain credentials or turn on processing by itself.

## Safe rollout order

1. Deploy a reviewed, immutable Git release into `/opt/sermonclip/releases/<sha>` and point `/opt/sermonclip/current` at it. The approved installer uses the exact 40-character Git SHA; it never deploys a branch name.
2. Create `/etc/sermonclip/worker.env` owned by `root:sermonclip`, mode `0640`, using Systems Manager Parameter Store and `deploy/scripts/render-pilot-worker-env.sh`. Do not put secrets in Git, user data, command text, or systemd unit files.
3. Install the unit files, run `systemctl daemon-reload`, and keep both services disabled until the web release and migrations have been verified.
4. Start the orchestration worker first and check its heartbeat, lease recovery, and dead-letter count. The legacy media worker is intentionally blocked by a local approval marker and must not be enabled during the staged-pilot rollout.
5. Keep the web control-plane flag off until the worker services are healthy. Enable it for one isolated test sermon only after explicit approval.

## Rollback

Disable and stop both units, repoint `current` to the prior release, run `systemctl daemon-reload`, and retain worker logs and orchestration records for diagnosis. Do not delete queues, audit records, or media as part of an operational rollback.

## Required runtime data

The worker environment needs the approved database connection, application URL/token, private source-storage configuration, and provider credentials. Those values must be supplied through the approved secret-management path; this repository intentionally contains no values.
