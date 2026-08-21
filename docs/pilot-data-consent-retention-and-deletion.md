# Pilot data, consent, retention, and deletion

**Applies to:** invite-only Sermon Clip pilot<br>
**Owner:** pilot privacy lead<br>
**Review:** before the first church, after any provider/storage change, and at
least monthly during the pilot

> This is practical operational guidance, not legal advice. Sermon recordings
> can reveal religious beliefs, children, health information, testimony, or
> pastoral-care details. Those categories may receive heightened protection
> under POPIA and other laws. Have South African counsel or the appointed
> Information Officer review the actual contracts, notices, lawful basis,
> cross-border transfers, retention periods, and incident duties before launch.

## 1. Responsibility model

For the pilot, document the parties rather than relying on labels alone:

- The church normally decides why its sermon and congregant media are recorded,
  processed, and published. Confirm whether it is the POPIA **responsible
  party** for those activities.
- Sermon Clip processes the material to provide the service. Confirm whether it
  acts as an **operator** and document its instructions, confidentiality,
  safeguards, subprocessors, deletion, audit, and incident-notification duties.
- Each cloud, AI, email, analytics, and social provider must appear in the
  subprocessor/data-flow record, including region and cross-border transfer
  where known.
- The church remains responsible for pastoral accuracy and permission to
  publish. Sermon Clip remains responsible for operating only within documented
  instructions and securing the service.

Do not use this wording as a legal conclusion. Record the conclusion reached by
qualified advice in the pilot agreement.

## 2. Consent and rights before upload

The application's `rightsConfirmed` field is a useful intake gate, but it is not
the underlying evidence of permission. The church keeps that evidence and the
operator records only a reference unless the agreement requires more.

### Church authorization

- [ ] An authorized church representative has approved the pilot and named the
      people allowed to upload, approve, and publish.
- [ ] The church has supplied its privacy notice/recording notice and confirmed
      the lawful basis for processing and publication.
- [ ] The church has confirmed rights to the recording, preaching, logos,
      artwork, Bible translation extracts, music, and third-party footage.
- [ ] YouTube or another source URL belongs to the church or is accompanied by
      documented permission; public availability is not itself permission.
- [ ] The church understands which providers receive media, audio, transcript,
      prompts, metadata, or publishing credentials.

### People shown or discussed

- [ ] Congregants had a clear recording notice and a practical way to avoid the
      camera where appropriate.
- [ ] A person giving a testimony has expressly approved short-form reuse and
      the proposed context, not merely the full service recording.
- [ ] Names, prayer requests, counselling details, health claims, financial
      hardship, safeguarding matters, and private pastoral disclosures are
      excluded unless the privacy lead records a specific approved basis.
- [ ] A parent/guardian and the church's safeguarding lead have approved any
      identifiable child. Pilot default: do not create clips centred on minors.
- [ ] Audience close-ups are avoided by default. If they are essential, the
      church approver checks every frame before publication.

### Editorial approval

- [ ] The named church approver checks the transcript against the recording.
- [ ] The clip retains the sermon’s meaning and necessary context.
- [ ] Scripture references, translation/version, names, dates, claims, captions,
      and translated wording have been checked.
- [ ] The approver reviews the exact rendered revision, not only draft text.
- [ ] The publisher checks the destination account and platform privacy setting.

Record the approval revision and time. A later edit invalidates the prior
approval and requires another review.

## 3. Data map to verify for each deployment

The current repository supports more than the local-only description on the
public privacy page. Before each pilot church starts, the technical responder
must complete this table for the deployed environment.

| Data/copy | Repository-supported location | Pilot control |
| --- | --- | --- |
| Account, church, sermon, transcript, workflow, audit, and publishing metadata | PostgreSQL/Neon | tenant scope; least privilege; database backup inventory |
| Direct-upload source recording | private AWS S3 | private bucket; signed access; tenant/object denial test; lifecycle and deletion inventory |
| Active source, audio, transcript JSON, renders, captions, exports, and logs | media-worker local storage | restricted host access; disk monitoring; archive before retention |
| Remote clip preview and temporary/generated publishing media | Cloudflare R2 when configured; some objects are reachable through a public base URL for review/platform fetching | unpredictable URLs are not access control; minimize lifetime; do not include sensitive clips; inventory and delete |
| Durable media archive | separate private R2 bucket when configured | archive-only credentials; additive upload; verified restore; separately reviewed pruning/deletion |
| Audio/transcript/prompt/output | configured AI provider, currently OpenAI paths exist | contract/data-use review; minimum necessary content; request/trace IDs rather than content in support records |
| Social account metadata and credentials | database/server configuration and connected platforms | encryption, least scopes, owner verification, revocation and provider-side disconnect |
| Logs, CI, hosting, email, analytics, and support evidence | configured vendors | no secrets or sermon text in tickets; access and retention review |

If a row is unknown, mark it **unknown and blocking**. Do not tell a church the
copy is private, local, deleted, or recoverable until it has been verified.

## 4. Data minimization

- Ask for a selected sermon window rather than a multi-hour full service.
- Prefer the original church upload; do not create additional operator copies.
- Do not upload counselling sessions, private prayer meetings, or safeguarding
  material.
- Keep support records to church ID, sermon/job/object IDs, timestamps, status,
  error category, provider request ID, and resolution. Redact URLs if they embed
  access tokens or signatures.
- Never place passwords, API keys, social tokens, signed media URLs, full
  transcripts, or identifiable testimony in chat, issue trackers, screenshots,
  or customer emails.
- Use a synthetic or expressly approved sermon for tests and restore drills.

## 5. Proposed pilot retention schedule

This is the default operating proposal, not a claim about current automation.
The church agreement and verified configuration are authoritative. Where legal
hold or safeguarding duties apply, the privacy lead records the exception and
obtains advice.

| Class | Proposed pilot default | End-of-period action | Current automation caveat |
| --- | --- | --- | --- |
| Temporary chunks, logs, rendered/captioned/overlay intermediates | 7 idle days | delete only after durable items are verified | repository retention tooling targets regenerable local material, skips processing projects and projects with any scheduled post, defaults to 7 days/20 projects/8 GiB reserve; the scheduled timer still requires deployment verification |
| Public preview/publishing staging objects | shortest practical period; target 14 days after delivery or immediately on verified request | inventory and delete | do not assume bucket lifecycle or complete pruning; a URL may remain usable until the object is removed |
| Source, extracted audio, transcript, approved exports, subtitles, thumbnails, content assets, branding, manifest | 90 days from upload for the pilot unless the church chooses less | verified deletion or documented extension | archive upload is additive and does not prune remote blobs |
| Posting metadata and provider IDs | 90 days after the relevant campaign, unless needed to investigate delivery | delete/anonymize where contract and platform permit | removing a Sermon Clip record does not remove a post from the social platform |
| Pilot account/workspace data | pilot term plus 30 days for orderly export/closure | close, export as agreed, then delete | full organization/account erasure is not yet a proven one-click workflow |
| Security/audit event metadata | 12 months, minimized and access-controlled | delete/anonymize unless needed for a live claim | sermon deletion intentionally retains a minimal `sermon.deleted` audit event |
| Database/object backups | the shortest window consistent with tested recovery; record actual vendor setting | expire through verified provider lifecycle | never promise a number until the deployed backup policy and restore drill prove it |

Run archive inventory/upload before local retention. Preview every retention
plan before applying it. Pilot staff must not run deletion, remote pruning, or a
production restore as part of an ordinary Sunday procedure.

## 6. Individual sermon deletion

The in-product project deletion requires the sermon title, denies deletion
while current processing/render/export/posting work is active, deletes the
tenant-scoped sermon and related database rows, attempts local project-folder
removal, and attempts deletion of validated R2 preview/publishing keys. It also
records a minimal deletion audit event and reports cleanup warnings.

It does **not**, by itself, prove erasure of:

- the private S3 source object;
- a content-addressed private archive blob;
- provider-held input/output or logs;
- database/object-storage backups;
- already published social posts or copies downloaded by church staff;
- a remote key that failed validation or deletion.

Therefore, project deletion is one step in the closure checklist, not the
customer-facing proof of complete erasure.

## 7. Data deletion request procedure

Pilot service targets: acknowledge within **2 business days**, verify scope
within **5 business days**, and complete ordinary verified requests within
**30 calendar days**. These are internal targets, not a statement of statutory
deadlines. The privacy lead must seek advice when law, legal hold, identity
dispute, child safety, or another responsible party changes the response.

### Receive and verify

- [ ] Create a request ID; record receipt time, requester, church, request type,
      and requested scope. Do not copy unnecessary personal content.
- [ ] Acknowledge receipt without confirming whether another person's data
      exists.
- [ ] Verify the requester through the church's known authorized contact and a
      second channel for account-wide, credential, or published-content cases.
- [ ] Classify the scope: connector, person/data item, sermon, workspace, or
      whole account.
- [ ] Pause new processing/publishing for affected material when needed. Revoke
      a social connection at the provider immediately when compromise is
      suspected.
- [ ] Check legal hold, safeguarding, ownership dispute, and required minimal
      audit evidence with the privacy lead.

### Inventory

- [ ] PostgreSQL records and deletion dependencies.
- [ ] Private S3 source object and incomplete multipart uploads.
- [ ] Worker-local active and legacy sermon folders.
- [ ] Public R2 preview and publishing-media keys.
- [ ] Private R2 archive manifest/blob references and whether a deduplicated blob
      is still referenced by another authorized project.
- [ ] Database and object-backup copies and their scheduled expiry.
- [ ] AI, email, analytics, support, hosting, and logging provider records where
      deletion/expiry is supported and required.
- [ ] Connected social accounts, provider tokens, scheduled jobs, and published
      posts. Ask the church whether posts and staff-downloaded exports are also
      in scope.

### Approve and execute

- [ ] Privacy lead approves the inventory; a second authorized operator checks
      sermon/workspace/object identifiers.
- [ ] Capture counts and non-sensitive identifiers before deletion. Do not retain
      the content as evidence.
- [ ] Execute the smallest scoped deletion using approved procedures. Never use
      broad database deletes, bucket pruning, or filesystem wildcards.
- [ ] Re-query/re-inventory every location and record success, not found, failed,
      retained-until-backup-expiry, and provider-action-required separately.
- [ ] If the application reports a local or remote cleanup warning, keep the
      request open and escalate; do not send completion language.
- [ ] Preserve only the minimal request/deletion audit record permitted by the
      agreement and law.

### Close

Send a plain-language closure stating:

- what was deleted;
- what the church must remove (for example a live social post or downloaded
  file);
- what remains temporarily in backups, why, who can access it, and the expected
  expiry date;
- any lawful/minimal record retained;
- how to challenge the outcome.

Never say “all data is permanently deleted” unless the completed inventory
supports that exact statement.

## 8. Offboarding a church or team member

For a team member: suspend/offboard access, revoke sessions, remove assignments,
review outstanding approvals/publishing jobs, rotate shared credentials, and
retain actor-attributed audit history. Do not transfer authorship by editing the
historical actor.

For a church: freeze new intake and publishing, agree an export window, inventory
all data/copies/connectors, revoke provider access, process deletion/retention,
verify backup expiry, and obtain closure acceptance from the authorized church
contact.
