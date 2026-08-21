# Sermon Clip production live regression — 2026-08-21

## Test identity and safety boundary

- **Started:** 2026-08-21T14:14:38Z / 2026-08-21 16:14:38 SAST
- **Completed:** 2026-08-21T14:25:54Z / 2026-08-21 16:25:54 SAST
- **Target:** `https://sermon-clip.vercel.app`
- **Local comparison:** branch `codex/ec2-deployment`, baseline commit `d83977a`, with preserved uncommitted Phase 1–7 and unrelated local work
- **Method:** deployed-browser observation plus safe, read-only route/API and repository integrity checks
- **Production writes permitted:** none

This regression intentionally does not submit forms, upload files, create or
delete records, enqueue processing/media, invoke transcription or AI, export
customer media, download private packages, publish, connect social accounts,
send email/social messages, mutate approvals, change settings, run migrations,
or alter cloud/configuration state. A test needing any of those actions is
recorded as blocked and requires a dedicated synthetic test tenant plus explicit
approval.

No credentials, cookies, tokens, customer names, sermon titles, transcript
text, media URLs, private notes, raw record identifiers, or private identities
are recorded here. Evidence is deliberately anonymized.

## Timestamped execution log

| Time (UTC) | Area | Observation/action | Result |
| --- | --- | --- | --- |
| 14:14:38 | Test start | Confirmed production target, local comparison SHA/branch, and no-write boundary. | PASS |
| 14:15:07 | Root/auth | Production root redirected to `/login`; no authenticated browser session was present. No credential entry attempted. First navigation completed in about 11.1 seconds. | PASS boundary / WARN cold latency |
| 14:15:31 | Login desktop | At 1280×720: one main landmark, one H1, labelled email/password controls, correct email/current-password autocomplete, skip link, no horizontal overflow. Optional workspace/MFA fields are collapsed. | PASS |
| 14:15:55 | Login mobile | At 390×844: primary login controls remained in the first viewport, 44–48px controls, no horizontal overflow, recovery/access links visible. | PASS |
| 14:16:25 | Public/legal | `/privacy`, `/terms`, and `/data-deletion` rendered at mobile width with headings, navigation, no forms, and no horizontal overflow. | PASS with title defect |
| 14:16:28 | Recovery | Forgot-password rendered its POST form but was not submitted. Reset-password without a token failed safely with a recovery link. Invitation without a token provided safe guidance and no form. | PASS read-only |
| 14:16:31 | Public share error | A nonexistent public sermon slug returned a branded 404 with library/home recovery options and no content leakage. | PASS |
| 14:16:58 | Auth boundary | Fourteen protected UI routes all redirected to login and retained the exact path in `returnTo`; no protected page content appeared. | PASS |
| 14:17:00 | Visibility | Browser made visible at user request; subsequent checks are shown live. | INFO |
| 14:17:19 | Pilot UI | `/health/pilot` returned the login boundary and preserved its path. Anonymous inspection cannot prove whether the Phase 7 page exists behind middleware. | PASS boundary / UNKNOWN deploy |
| 14:18:39 | HTTP/TLS | Login returned 200, private/no-store caching and preload HSTS. Common CSP, anti-framing, MIME-sniffing, referrer, and permissions headers were absent. | FAIL security hardening |
| 14:19:01 | Release probe | A known route and a deliberately nonexistent protected route both returned the same anonymous 401/no-store response. Anonymous 401 is not valid evidence that Phase 7 is deployed. | INCONCLUSIVE by design |
| 14:19:29 | Recovery headers | Forgot-password, reset-password, and invitation pages all returned private/no-store responses. | PASS |
| 14:20:01 | Worker boundary | Worker/health endpoints denied anonymous access and returned no operational payload. The denied upcoming-work response was nevertheless marked public-cacheable. | PASS denial / FAIL cache policy |
| 14:20:19 | Tenant spoofing | Fake external organization, campus, actor, and authentication headers did not grant `/health` access. | PASS |
| 14:20:34 | Media boundary | Source preview, clip preview, thumbnail, download, and content-package routes all returned anonymous 401 with `no-store`. | PASS |
| 14:20:45 | Public API errors | Missing public logo returned 404; CTA endpoint rejected HEAD with 405; neither exposed content. | PASS |
| 14:21:22 | Legal accuracy | Production privacy and terms pages still describe a mainly local-Mac/media-worker architecture, while the repository supports private S3 intake, R2 preview/publishing staging, and a private R2 archive. | FAIL launch gate |
| 14:21:39 | Deletion UX | Public deletion guidance covers credential/account records but gives no retention period, response timeline, media/object-store scope, backup/archive handling, or status/appeal path. | FAIL pilot clarity |
| 14:22:05 | Auth redirect safety | An external `returnTo` value was reduced to `/` in the login form; no external links were produced. | PASS |
| 14:22:18 | Reset-link shell | A fabricated reset token opened the password form and was retained only in a hidden field; server-side token rejection could not be tested without submitting a live mutation. | BLOCKED submit |
| 14:23:33 | Public timing sample | One low-volume HTTP sample measured login ~0.52s, privacy ~0.45s, and missing public-sermon ~1.39s total. | PASS directional only |
| 14:23:41 | Public status | The missing public-sermon page rendered a 404 experience but returned HTTP 200/no-store. | FAIL soft 404 |
| 14:25:54 | Test close | Closed the safe anonymous/read-only run. Authenticated and state-changing coverage remains explicitly blocked; no action was submitted. | COMPLETE within safety boundary |

## Executive conclusion

The safe anonymous production boundary is functioning: login and recovery
surfaces render on desktop/mobile, protected UI and private-media routes deny
anonymous access, forged tenant headers did not bypass authentication, and no
private content was observed. However, this is **not a passed full regression**
and is not sufficient evidence to approve a 5–10 church pilot. No authenticated
session was available, so the application's core value path—from sermon intake
through processing, pastor review, Content Week, handoff, export, publishing,
and pilot telemetry—could not be exercised.

The anonymous run also found three pilot launch gates: the published privacy and
terms language does not match the repository's S3/R2 media topology; deletion
guidance is incomplete for source and derived media, archives, backups, timing,
and verification; and the login/public responses lack a defined browser-security
header baseline. Four further release/operability defects should be addressed:
no safe release identifier, a public-cacheable worker 401, pre-Phase-4 recovery
copy in production, and a public missing-sermon route that returns HTTP 200.

**Decision:** keep production limited to the current anonymous boundary and
internal preparation. Do not describe the product as pilot-regression-passed
until an approval-gated synthetic tenant validates the complete authenticated
journey and the P1 legal/security gates are closed.

## Environment and release evidence

- Production origin was loaded from the repository's public application URL
  configuration and verified by navigation.
- The browser had no existing signed-in production session. Authenticated
  content and role-specific screens therefore remain blocked rather than
  bypassed.
- Page title identifies Sermon Clip's church content studio. No deployed build
  SHA or release identifier is exposed in the inspected UI, so exact commit
  attribution is currently unknown.
- Initial root-to-login navigation was approximately 11.1 seconds; subsequent
  public/protected navigations observed so far were generally about 0.5–1.2
  seconds, except the missing public-sermon route at about 2.6 seconds. These
  are single-browser observations, not an SLA or statistically valid sample.
- HTTPS is served by Vercel with long-lived preload HSTS. Public legal pages
  are statically cached; authentication/recovery pages are private/no-store.
- Production's public 404 wording matches the pre-Phase-4 baseline rather than
  the current local recovery copy. This is direct evidence that at least the
  local Phase 4 recovery changes are not deployed.

## Regression matrix

| ID | Area | Safe production test | Result |
| --- | --- | --- | --- |
| LR-001 | Root/login | Anonymous root redirect and login rendering | PASS |
| LR-002 | Accessibility | Main/H1, labels, autocomplete, skip link | PASS |
| LR-003 | Mobile | 390×844 login overflow and first action | PASS |
| LR-004 | Legal | Privacy, terms, deletion pages | PASS with P3 title issue |
| LR-005 | Recovery | Forgot/reset/invitation safe empty-token states | PASS; submission blocked |
| LR-006 | Public share | Missing slug recovery and leakage check | PASS |
| LR-007 | Protected UI | 14 representative workspace routes | PASS auth boundary |
| LR-008 | HTTP security | TLS, cache, browser-security response headers | FAIL |
| LR-009 | Worker privacy | Anonymous health/upcoming/heartbeat/system endpoints | PASS denial; one cache defect |
| LR-010 | Tenant spoofing | Fake trusted-context headers from the public edge | PASS denial |
| LR-011 | Private media | Five representative media/download routes | PASS 401/no-store |
| LR-012 | Legal accuracy | Public policy/terms vs repository architecture | FAIL |
| LR-013 | Deletion clarity | Scope, timing, retention, archive and recovery language | FAIL |
| LR-014 | Open redirect | External login return target | PASS client/server-rendered sanitization |
| LR-015 | Console health | Public error and recovery pages | PASS; no warnings/errors observed |
| LR-016 | Public status semantics | Missing `/s/[slug]` response code | FAIL: visual 404 / HTTP 200 |

## Defects and release gaps

### REG-001 — duplicated product suffix in legal page titles

- **Severity:** P3 / polish and search-result quality
- **Observed:** privacy, terms, and data-deletion titles render in the form
  `Page | Sermon Clip | Sermon Clip`.
- **Impact:** untidy browser/search titles; no workflow or data-safety impact.
- **Reproduction:** open any of the three public legal routes anonymously.

### REG-002 — no deploy/release identifier visible to operators

- **Severity:** P2 / operational traceability
- **Observed:** inspected production UI exposes no safe release SHA/version.
- **Impact:** a live defect cannot be tied confidently to the deployed code;
  Phase 1–7 release-integrity comparison must rely on route/behavior evidence.
- **Reproduction:** inspect login, legal, error, or unauthenticated health path.

### REG-003 — login and public pages lack a browser-security header baseline

- **Severity:** P1 / launch security gate
- **Observed:** HTTPS/HSTS is present, but inspected GET responses did not
  include `Content-Security-Policy`, a `frame-ancestors` policy or
  `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, or
  `Permissions-Policy`.
- **Impact:** the login surface has no response-level anti-framing control and
  the application lacks a centrally verifiable browser hardening baseline.
- **Reproduction:** inspect the production GET response headers for `/login`
  and `/privacy`.

### REG-004 — public privacy and terms describe the wrong storage topology

- **Severity:** P1 / pilot launch blocker pending privacy/legal review
- **Observed:** the June 28 policy/terms describe media and posting workers as
  remaining mainly on a user's local Mac and cloud storage as lightweight
  metadata. The repository supports private S3 source intake, worker-local
  materialization, R2 preview/publishing staging, and a separate private R2
  archive.
- **Impact:** a church cannot make an informed consent or vendor-risk decision
  from the published policy. Retention/deletion promises cannot be reconciled
  to the implemented data flow.
- **Reproduction:** compare `/privacy` and `/terms` with the documented current
  storage paths in the repository; no production credentials are needed.

### REG-005 — deletion instructions omit pilot-critical scope and timing

- **Severity:** P1 / pilot operations and trust
- **Observed:** the public page describes an email-based request and connected
  social-account records but does not state a response timeline, verification
  workflow, source/derived media scope, object storage/archive/backups,
  retention exceptions, completion evidence, or escalation route.
- **Impact:** operators and churches cannot predict what deletion means across
  the actual architecture or verify completion.
- **Reproduction:** read `/data-deletion` anonymously.

### REG-006 — anonymous worker 401 response is public-cacheable

- **Severity:** P2 / defense in depth
- **Observed:** `/api/automation/upcoming` correctly returns only an anonymous
  401 error, but its response says `Cache-Control: public, max-age=0,
  must-revalidate` instead of `private, no-store`.
- **Impact:** no data leaked in this test, but authentication responses should
  not be reusable by shared caches and the policy differs from other protected
  APIs.
- **Reproduction:** anonymous GET or HEAD to the endpoint.

### REG-007 — Phase 4 recovery copy is not deployed

- **Severity:** P2 / release gap
- **Observed:** the live missing-sermon page still says “Nothing here” and
  returns to studio home. The preserved local Phase 4 change uses tenant-safe
  wording, distinguishes unavailable/other-workspace cases, and offers the
  sermon library plus intake recovery.
- **Impact:** current production recovery is less clear for pastors and is
  positive evidence that the local Phase 1–7 release set is not the deployed
  experience.
- **Reproduction:** open a nonexistent `/s/[slug]` and compare with the local
  `src/app/not-found.tsx` diff.

### REG-008 — missing public sermon is a soft 404

- **Severity:** P2 / public-link correctness
- **Observed:** a nonexistent `/s/[slug]` renders a branded “sermon not found”
  page but returns HTTP 200. The public logo resource correctly returns 404.
- **Impact:** link checkers, crawlers, monitoring, and cache/CDN diagnostics can
  classify a broken sermon link as healthy.
- **Reproduction:** request a guaranteed-missing public sermon slug and compare
  the rendered page with the HTTP status.

## Blocked or deliberately untested

- Authenticated dashboard, sermon library, intake, progress, review, Studio,
  Content Week, growth, team, publishing desk, health, and pilot telemetry:
  **blocked because no pre-existing authenticated session is present**.
- Forgot-password request, invitation acceptance, login, and password reset:
  **forms not submitted because they send/write live state**.
- Exact deployed commit, Phase 1 RLS/migration state, backup/restore evidence,
  worker heartbeat health, queue state, Phase 5 cost evidence, Phase 6 governed
  handoff, and Phase 7 telemetry/export: **not inferable anonymously**.
- Production database migration, aggregate reliability, and worker-state checks:
  **blocked because the configured database was unreachable from this isolated
  test environment**. The failed connection yielded no record data and was not
  retried after the instruction to close the run.
- Direct browser navigation to protected API/download URLs was blocked by the
  browser client before navigation; independent read-only HTTP checks were
  used for status/header evidence instead.

### Authenticated coverage still required

| Journey | Required pilot evidence | Current status |
| --- | --- | --- |
| Onboarding and sermon intake | Church context, source validation, consent, upload/link recovery, mobile intake | BLOCKED — no session; no source submitted |
| Processing visibility | Queue delay, stage truthfulness, estimates, retry/degraded/cancel states | BLOCKED — no session or existing safe test sermon |
| First value and review | Ranked suggestions, one playable branded preview, top-three progression, pastoral context and decisions | BLOCKED — no session; no media played |
| Quick Finish and Studio | Default/simple path, Advanced Studio disclosure, edits and approval provenance | BLOCKED — no session; no mutation authorized |
| Content Week and growth | On-demand completion, hierarchy, readiness and failure handling | BLOCKED — no session |
| Team and governance | Role boundaries, handoff, changed-after-approval blocking, cross-tenant denial | BLOCKED — requires controlled multi-role tenant fixtures |
| Export and publishing | Preflight, private default, explicit intent, connector idempotency, reconciliation | BLOCKED — live export/send forbidden |
| Analytics and pilot telemetry | Denominators, unknown-state handling, percentiles, support/cost capture, board export | BLOCKED — no session and route existence cannot be inferred through middleware |
| Backup/recovery | Inventory, retention and isolated restore proof | BLOCKED — operational evidence unavailable; no live backup/restore permitted |

## Release-integrity interpretation

- **Proven not deployed:** the local Phase 4 missing-content recovery language;
  production still serves the older copy.
- **Unknown in production:** the remaining Phase 1–7 database, orchestration,
  progressive-value, quality/cost, publishing, and pilot-measurement changes.
  Anonymous middleware responses cannot prove route or feature deployment.
- **Not a production regression yet:** behavior that exists only in the dirty
  local worktree cannot be classified as a live regression until it is deployed
  to an isolated environment and compared. The report therefore records it as a
  release gap or unknown, not as a production failure.

## Evidence and limitations

Visible, anonymized screenshots captured during the run:

- [`screenshots/production-login-mobile-2026-08-21.png`](screenshots/production-login-mobile-2026-08-21.png)
- [`screenshots/production-privacy-mobile-2026-08-21.png`](screenshots/production-privacy-mobile-2026-08-21.png)
- [`screenshots/production-public-sermon-404-desktop-2026-08-21.png`](screenshots/production-public-sermon-404-desktop-2026-08-21.png)

Coverage comprised eight representative anonymous/public UI routes, fourteen
protected UI paths, the login/open-redirect boundary, five private-media routes,
and representative worker/system/pilot endpoints. Timings are single samples
from one location and must not be used as percentile, capacity, or SLA evidence.
The keyboard-focus probe was inconclusive because the browser harness retained
focus on the page body; it is not recorded as a product defect. No production
record, private object, or customer content was read.

## Prioritized recommendation

1. **P1 — before any church pilot:** reconcile privacy, terms, consent,
   retention, deletion, backup/archive, and subprocessors with the actual S3/R2
   data flow; obtain privacy/legal owner sign-off.
2. **P1 — before accepting pilot credentials:** define and verify a response
   security-header baseline for login and public pages, including CSP with
   anti-framing, MIME-sniffing protection, referrer policy, and an appropriately
   scoped permissions policy. Roll out in report-only/staging first where needed
   to avoid breaking media and auth flows.
3. **P1 — deployment traceability:** expose a non-sensitive build/release ID in
   operator health evidence and produce a Phase 1–7 deployment manifest. Apply
   migrations and configuration only through a separately approved rollout.
4. **P1 — approval-gated pilot regression:** create an isolated synthetic church
   with pastor, communications, and publisher test identities plus approved,
   non-customer media. Exercise the complete intake-to-handoff journey, tenant
   denial, retries, degraded states, cancellation, exports, private publishing
   preflight, telemetry, and recovery without involving customer records.
5. **P2 — correctness and operations:** return a true 404 for missing public
   sermons, make every denied worker/API response private/no-store, deploy the
   Phase 4 recovery improvements with the wider gated release, and add safe
   queue/worker/readiness evidence.
6. **P3 — polish:** remove duplicated product suffixes from legal-page titles
   and repeat mobile/accessibility checks in the authenticated journeys.

## Pilot stop/go gate

**Current status: NO-GO for an external 5–10 church pilot; GO only for continued
internal, no-customer preparation.** Move to a controlled pilot only after the
three P1 legal/security/deletion gates are closed and a synthetic authenticated
regression passes with release-ID evidence. The next live regression requires
explicit approval for its test tenant, identities, media, allowed mutations,
provider fakes/sandboxes, cleanup/retention rules, and named operator rollback
authority.

No production state, customer data, configuration, cloud resource, deployment,
commit, or external message was changed during this run.
