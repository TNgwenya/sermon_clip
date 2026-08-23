# Live stream intake pilot

## Product promise

A church configures one private Sermon Clip RTMPS destination once in YoloBox or OBS. It keeps its existing YouTube/Facebook destinations. After a service ends, the provider finalizes a recording and Sermon Clip creates a normal, review-first sermon workflow. No direct publishing is enabled.

## Security boundary

- `CLOUDFLARE_STREAM_API_TOKEN` must be a scoped token held only by the application runtime.
- `LIVE_INTAKE_WEBHOOK_SECRET` authenticates the provider adapter callback; it must not be a browser-accessible value.
- The returned stream key is displayed once to a church administrator and is not written to the database or logs.
- The public callback only records an idempotent receipt. A trusted worker must copy the completed provider recording into tenant-owned private source storage before a sermon is queued.

## Required deployment work

1. Apply the Phase 1, Phase 2, then `20260823110000_live_stream_intake` migrations with the non-owner runtime role.
2. Enable Cloudflare Stream billing and create a narrow API token with live-input create/read permissions only.
3. Add `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_STREAM_API_TOKEN`, and a random `LIVE_INTAKE_WEBHOOK_SECRET` to the application/worker secret store. Never put them in a client bundle.
4. Deploy the provider adapter that verifies provider-native callbacks and translates them to the internal callback contract.
5. Implement/enable the worker materialization adapter for provider recordings, proving it copies a recording to the tenant-owned private source bucket before it calls `queueMaterializedLiveRecording`.
6. Pilot one church and one stream. Confirm key rotation, disabled-stream behavior, callback dedupe, retention deletion, and no automatic publishing.

## Explicit non-goals

No public playback, social restreaming, automatic publishing, or user-device download is part of this pilot.
