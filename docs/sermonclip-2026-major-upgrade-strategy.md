# SermonClip Major Upgrade Strategy

**Assessment date:** 29 July 2026

**Planning horizon:** 12 months
**Mandate:** Make SermonClip the world’s best church-specific system for turning one sermon into a pastor-approved, on-brand, publishable week of content—and prove that it helps church teams communicate consistently without compromising the meaning of the message.

## Executive decision

SermonClip should not try to beat CapCut by reproducing every general-purpose editing feature, and it should not try to beat OpusClip by making a louder “viral” claim.

It should win a narrower and more valuable job:

> **One sermon in. One ministry-safe week out. Reviewed by the right people, published through the right channels, and improved by evidence.**

The category to own is **the church content operating system**.

CapCut is a broad creative editor. OpusClip is a generic AI clipping engine. Pastors.ai is a low-friction sermon inbox. ChurchSocial.ai is already a church content-and-scheduling suite. SermonClip’s defensible position is the complete message-to-ministry workflow: sermon understanding, editorial integrity, church governance, multi-format content, publishing, and ministry outcomes.

The current repository contains unusually deep product foundations:

- Sermon-aware clip selection, boundary and completeness review.
- Transcript safety, exact source context, and human approval.
- Smart crop, captions, branding, cover frames, rendering, and export.
- Quote, Scripture, prayer, devotional, carousel, invitation, guide, and calendar content models.
- Durable processing jobs, leases, heartbeats, retries, and conservative publishing receipts.
- Social OAuth, scheduling, analytics, campaigns, and ministry outcome models.
- A strong automated test base: **2,217 tests passed across 207 test files** on this assessment.

However, this breadth is not yet a sellable multi-church SaaS. Five facts control the roadmap:

1. There are no users, church workspaces, memberships, roles, invitations, tenant boundaries, billing, or entitlements.
2. The product’s “one sermon → one week” promise is fragmented across Review, Studio, Content Ideas, Weekly Plan, and Ready to Post.
3. Pastor Review and Clip Studio expose too much complexity for ordinary church teams.
4. Core trust signals are not yet reliable enough: the seeded review queue had no playable previews, machine-like titles, and repetitive verification.
5. The Brand Kit route currently crashes at runtime even though lint, unit tests, TypeScript, and the production build pass.

The correct order is therefore:

1. Stabilize, measure, and resolve the naming risk.
2. Build the identity, tenancy, entitlement, and cloud-media control plane.
3. Collapse the existing engine into a unified Week Draft and exception-driven approval flow.
4. Add role-aware collaboration, handover, and reliable publishing.
5. Close the learning loop around ministry outcomes.
6. Build the long-term creative and data moat.

No independent churches should share the production environment until tenant isolation and authorization pass their launch gate.

---

## How this assessment was conducted

Four parallel workstreams were assigned:

| Workstream | Assignment | Output |
|---|---|---|
| CEO/CTO integration | Inspect the repository, run the product, verify quality gates, reconcile evidence, and own the final strategy | Current-state verdict, sequencing, team, metrics, and operating plan |
| Competitive intelligence | Compare OpusClip, CapCut, church-specific competitors, pricing, workflows, positioning, and claims | Market matrix, whitespace, name collision, and benchmark requirements |
| Product design and church workflow | Audit live desktop/mobile experiences and code from pastor, volunteer, comms, approver, and multi-campus perspectives | Severity-ranked UX findings and target “one sermon → one week” journey |
| Platform, security, and growth | Audit architecture, auth, tenancy, profiles, handover, media, jobs, AI, publishing, security, privacy, observability, billing, and analytics | Risk register, SaaS architecture, SLOs, and phased technical plan |

Local verification completed:

- `npm test`: **207 test files passed, one skipped; 2,217 tests passed, two skipped**.
- `npm run lint`: passed.
- `npm run build`: passed, including TypeScript and production route generation.
- Live route walkthrough on desktop and a 390 × 844 mobile viewport.
- Core flows reviewed: Home, sermon intake, Pastor Review, Clip Studio, Content Ideas, Weekly Plan, Ready to Post, Growth, Brand Kit, and Social Settings.
- Playwright smoke suite: one of three tests passed; two failed because assertions and navigation labels are stale. The suite does not currently cover Brand Kit and therefore does not catch its runtime crash.

The existing `docs/` audits remain useful historical context, but this document supersedes them as the integrated strategy.

---

## Current product assessment

### What is genuinely strong

#### 1. The content engine is church-specific

The repository does not merely slice video. It represents prayer, altar calls, Scripture teaching, testimony, application, discipleship, worship moments, and ministry risk. It preserves exact transcript evidence and can generate mixed-format assets. That is a stronger product foundation than a generic “virality score.”

#### 2. Human review is a first-class principle

Pastor Review explains why a moment was chosen, shows the exact words, identifies context risk, and blocks approval when transcript confidence requires human confirmation. Publishing logic also fails conservatively when media, permissions, credentials, or composition identity are uncertain.

#### 3. Media and publishing safety are beyond ordinary MVP quality

The upload path is resumable and validates media. Processing jobs use leases and heartbeats. Social credentials are encrypted. Publishing uses idempotency and separates external provider success from database receipt persistence so a retry does not create a duplicate public post.

#### 4. The visual identity is differentiated

The dark, editorial studio aesthetic feels like a premium creator product rather than a generic admin dashboard. The home screen communicates a calm, church-specific promise. Mobile layouts inspected at 390 px did not overflow horizontally.

#### 5. The codebase has substantial automated coverage

The unit/component suite is unusually broad. The problem is not lack of tests; it is that the current quality pyramid underweights runtime integration, real-media quality, accessibility, and end-to-end outcomes.

### The launch-blocking gaps

#### P0 — No SaaS identity or tenant boundary

The app is protected by a shared Basic Auth password in `src/proxy.ts`. The Prisma schema has no `User`, `Organization`, `Church`, `Campus`, `Membership`, `Role`, `Invitation`, or `Session` model. Branding, sermons, media, social credentials, posts, analytics, AI cache entries, and growth records are global.

This is a catastrophic cross-customer risk if multiple churches are added. It also makes profiles, accountable approvals, ownership transfer, volunteer offboarding, and billing impossible.

#### P0 — Brand Kit is broken

`src/app/settings/branding/branding-settings-form.tsx` is a client component but imports a runtime value from `src/server/branding/settings.ts`, which initializes Prisma. The live route fails with “PrismaClient is unable to run in this browser environment.”

This blocks activation and damages confidence in a core differentiator.

#### P0 — The headline workflow is fragmented

Today, a church may need to:

1. Process the sermon.
2. Review each clip.
3. Enter Studio for edits.
4. Prepare clips.
5. Discover Content Ideas.
6. Explicitly generate a content pack.
7. Review and approve each non-video asset.
8. Prepare or design each asset.
9. Open Ready to Post.
10. Open Weekly Plan or the calendar.
11. Schedule or download.

The weekly content pack must be the primary object created automatically from every completed sermon, not a downstream tool a user discovers.

#### P0 — Review and Studio are too cognitively expensive

The seeded Pastor Review page rendered approximately:

- 2,444 words.
- 113 buttons.
- 8,483 px of desktop document height.
- 15,082 px at 390 px mobile width.

The seeded Clip Studio rendered approximately:

- 2,151 words.
- 358 buttons.
- 132 fields.
- 18,130 px at 390 px mobile width.

The product currently asks a pastor to think like a reviewer, transcript editor, video editor, brand designer, and production technician at the same time.

Two explicit modes are required:

- **Quick Finish:** crop, caption style, headline, brand preset, and “Looks good.”
- **Advanced Studio:** the existing expert tool, entered intentionally.

Pastor Review should be a one-card-at-a-time decision queue with no production controls.

#### P0 — Preview and copy quality are below the trust threshold

The test sermon had no playable review previews. Titles such as “Need Stay Understand Need Obey” and deterministic fallback explanations reached the customer-facing UI.

The review moment is where a pastor decides whether the system understood the sermon. Internal fallback copy and missing media cannot appear there.

#### P1 — There is no first-run onboarding

The product has no church creation flow, profile, team invitations, channel setup, posting cadence, approval policy, sample project, activation checklist, or celebration of first value. Intake asks for church information that should come from a workspace default.

On the inspected mobile intake screen, the primary Analyze action appeared roughly 1,832 px down the page. The first-time path should request only the minimum needed to begin.

#### P1 — Publishing and Growth contain value but are disconnected

Ready to Post combines selection, preparation, copy, handoff, scheduling, service health, calendar, history, and worker details. Growth contains strong concepts but mostly appears after the user has navigated the fragmented publishing journey.

Growth recommendations should return directly to the current Week Draft as short decisions, for example:

- “Tuesday teaching clips earned more saves than Friday posts.”
- “This week is missing an invitation asset.”
- “Do not repeat this point; it was posted last week.”
- “This clip fits YouTube Shorts better than Instagram.”

#### P1 — Handover is a file package, not a team workflow

Email and WhatsApp handoff packs are useful, especially for small churches, but they do not provide:

- Assignee and due date.
- Approval request and decision.
- Comments and change requests.
- Notifications and reminders.
- Locked approved revision.
- Activity and download/post receipt.
- Safe ownership transfer when a staff member leaves.

---

## Competitive landscape

All pricing and capabilities below are vendor-advertised as of 29 July 2026 and must be rechecked before sales or investor use. No vendor marketing page proves superior clip quality.

| Product | Advertised price | Strongest capability | Weakness SermonClip can exploit |
|---|---:|---|---|
| [OpusClip](https://www.opus.pro/pricing) | Free; Starter $15/mo; Pro $29/mo; Business custom | Generic multimodal clipping, strong captions/reframing/editor, scheduler, team workspace | No church content pack, Scripture/context governance, church approvals, or ministry outcomes |
| [CapCut](https://www.capcut.com/tools/long-video-to-shorts) | Regional/dynamic; Teams commonly starts around $15–$30/seat/mo annually | Deepest creative editor across mobile, web, and desktop; large effects/template ecosystem | Too broad and complex for the complete weekly church job; no native ministry workflow |
| [ChurchSocial.ai](https://www.churchsocial.ai/products/sermon-studio) | $15/mo solo or $25/mo unlimited users; Sermon Studio +$49; Design +$15 | Closest end-to-end church threat: clips, content, graphics, Planning Center, calendar, publishing, teams | Public evidence of editing depth, governance, security, and quality measurement is limited |
| [Pastors.ai](https://pastors.ai/) | Free; Pastor $30/mo; Team $75/mo | Best low-friction acquisition: paste a YouTube URL, receive clips and discipleship resources by email; archive chatbot | Less editing, planning, publishing, governance, and outcome depth |
| [Sermon Shots](https://sermonshots.com/features/) | Tiered church plans; current effective pricing should be rechecked | Mature sermon workflow, livestream ingest, transcript editing, clips, blog, devotional, quote images | Less visible team governance, scheduling, and growth loop |
| [Pulpit AI](https://www.pulpitai.com/pricing) | $39/$59/$129 per month | Broad sermon-derived ministry resources and Subsplash distribution | Scheduling, analytics, and governance are not its visible center |
| [Sermon Clips](https://sermon-clips.com/) | $15/week; advertised $49 founding and $99 standard monthly rates | Almost identical name and high-overlap sermon-specific promise | Several auto-posting/analytics capabilities are described as future; public pricing is internally inconsistent |
| [Pulpit Engine](https://www.pulpitengine.com/) | $500/$1,000/$1,500 per month | Premium zero-labor, done-for-you model | High cost, incomplete platform rollout, less self-service |
| [The Pulpit App](https://thepulpit.app/) | Free trial plus sermon passes | Local/browser-first privacy and simple clip workflow | Narrow clip-only scope and limited team/distribution system |

### The two most dangerous competitors

#### ChurchSocial.ai

It already packages church content creation, visual planning, team access, Planning Center integration, scheduling, and publishing at an aggressive price. SermonClip cannot enter the market with only “church-specific clips.” The product must be clearly better at content integrity, approval, multi-format weekly execution, and actionable learning.

#### Pastors.ai

It establishes the convenience benchmark: paste a YouTube link, leave, and receive content by email. SermonClip’s onboarding must be at least as simple even if the product later offers a deeper workspace.

### Naming and SEO risk

`sermon-clips.com`, `sermonclips.app`, and other similarly named products create an immediate collision. Before acquisition spend:

1. Commission a trademark and domain clearance search in target markets.
2. Review App Store, social handle, paid search, and organic search collision.
3. Decide within Phase 0 whether “SermonClip” remains defensible.
4. If not, rename before scaling content marketing, integrations, or partner programs.

This is not a cosmetic issue. It affects discoverability, legal risk, support confusion, and category ownership.

### Strategic positioning

Recommended category:

> **The church content operating system**

Recommended product promise after validation:

> Connect Sunday’s sermon once. Review a complete, ministry-safe week of content in one place. SermonClip keeps the pastor’s meaning, the church’s voice, and the team’s approvals intact—then shows what moved people beyond a view.

Do not market “more features than CapCut.” Market a dramatically better **time to an approved, published church content week**.

---

## Target product: the Week Draft

The core product object should be a **Week Draft**, created automatically when sermon analysis completes.

### Default output

A configurable default Week Draft should contain 5–7 usable items across at least three formats:

| Weekly role | Example output | Primary purpose |
|---|---|---|
| Sermon recap | 45–75 second clip | Carry the main message into Monday |
| Teaching moment | 45–90 second clip | Explain a Scripture or application clearly |
| Encouragement/prayer | Short clip or audio-backed graphic | Pastoral care and shareability |
| Quote/Scripture | Branded graphic | Save/share and visual consistency |
| Carousel/devotional | 4–7 slides or short reading | Deeper learning and discipleship |
| Discussion/WhatsApp | Small-group prompt or share card | Community conversation |
| Weekend invitation | Graphic/clip and platform copy | Invite the next step |

The actual mix should depend on the sermon, the church’s channels, its preferred cadence, upcoming events, and content already published.

### Every asset must carry provenance

Each Week Draft item needs:

- Exact sermon and transcript source.
- Start/end timestamp or transcript segment IDs.
- Asset purpose.
- Intended audience.
- Scripture reference and selected translation where relevant.
- AI/model/prompt version.
- Confidence and reason for any required review.
- Current owner, state, blocker, and next action.
- Current revision, approval status, and publishing identity.

### Ideal end-to-end journey

```mermaid
flowchart LR
    A["Connect the church once"] --> B["Add or auto-import Sunday’s sermon"]
    B --> C["Generate one Week Draft"]
    C --> D["Pastor Approval Inbox"]
    D --> E["Media-team Quick Finish"]
    E --> F["Approve, hand over, or schedule"]
    F --> G["Publish with a verified receipt"]
    G --> H["Learn and improve next week"]
```

#### 1. Connect the church once

Create the organization and optional campuses; import the brand kit; connect channels; choose timezone, posting cadence, preferred Bible translation, church glossary, approval policy, and team roles.

#### 2. Add Sunday’s sermon

Support upload, YouTube, cloud drive, or verified streaming import. Auto-fill title, preacher, date, and duration. Ask whether the source is sermon-only or a full service. Let the user leave while processing continues.

#### 3. Generate one Week Draft automatically

No second “create content pack” action. Generate clips, graphics, written content, suggested copy, and a recommended calendar together. Link every item to source evidence.

#### 4. Pastor Approval Inbox

Show one item at a time:

- Playable preview.
- What it is for.
- Exact source context.
- Any selective warning.
- **Approve**, **Edit wording**, or **Leave out**.

Show progress such as “5 of 7 reviewed · about 3 minutes left.” Never show production controls here.

#### 5. Media-team Quick Finish

Expose no more than eight controls:

- Format.
- Crop/framing.
- Caption preset.
- Caption wording.
- Cover/headline.
- Brand preset.
- Audio cleanup.
- Looks good / prepare.

Advanced Studio remains available for skilled editors.

#### 6. Approval and handover

Assign work, request approval, comment, request changes, lock the approved revision, and notify the publisher. Preserve email/WhatsApp download packs for churches that prefer an offline handoff.

#### 7. Week Calendar

Present a suggested seven-day mix only after usable assets exist. Show exact platform previews and copy. Run duplicate-topic, timezone, account, permission, service-health, and immutable-composition preflight before scheduling.

#### 8. Publish and learn

Record an automatic or manual publishing receipt. Return a short weekly report:

- What shipped.
- What was skipped and why.
- Retention, saves, shares, and full-sermon follow-through.
- Opt-in ministry outcomes such as plan-a-visit clicks, prayer requests, group interest, and event registrations.
- One or two recommended changes for the next Week Draft.

---

## Product design principles

1. **One recommended action per surface.** Secondary actions belong in a menu or disclosure.
2. **Review exceptions, not machinery.** Most content should be approvable quickly; only uncertain items should demand detailed inspection.
3. **Quick by default, advanced by choice.** Never force a volunteer into the full editor.
4. **Show the asset, not the system.** Playable media and visual content are the anchor; metrics and diagnostics support the decision.
5. **Use ministry language.** Hide job types, workers, freshness enums, provider codes, and storage concepts.
6. **Preserve meaning over engagement.** A high-performing hook that distorts the sermon is a failed asset.
7. **Make the next owner visible.** Every item shows who has it, what is blocking it, and what happens next.
8. **Mobile is an approval device first.** Upload, review, comment, approve, reschedule, and hand over must be excellent on a phone.
9. **Calm state vocabulary.** Use a small global vocabulary: Draft, Needs review, Needs changes, Approved, Preparing, Ready, Scheduled, Published, Needs attention.
10. **No dead or premature UI.** Hide calendar days, integrations, and expert controls until the user can act on them.

---

## Church profiles, access, approvals, and handover

### Required user and organization model

Add:

- `User`
- `UserProfile`
- `Identity`
- `Session`
- `MfaFactor`
- `Organization`
- `Campus`
- `Membership`
- `Invitation`
- `Role`
- `Permission`
- `RoleBinding`
- `ApprovalPolicy`
- `ApprovalRequest`
- `ApprovalDecision`
- `Assignment`
- `Comment`
- `Notification`
- `OwnershipTransfer`
- `AuditEvent`

Every customer-owned row must carry an immutable `organizationId`. Campus-specific content additionally carries `campusId`. Tenant scope must be part of unique constraints, AI cache keys, object-storage keys, job claims, and social publishing identities.

### Recommended role templates

| Role | Default capabilities |
|---|---|
| Owner | Legal/billing ownership, organization transfer, all administration |
| Organization Admin | People, campuses, brand defaults, channels, policies |
| Campus Admin | Campus people, brand, channels, and calendar |
| Pastor / Theology Approver | Review sermon fidelity and sensitive content |
| Content Lead | Own Week Draft, assignments, and final content mix |
| Editor | Edit clips, copy, graphics, and design |
| Publisher | Connect allowed channels, schedule, publish, and reconcile |
| Analyst | View performance and outcome reports |
| Viewer | Read-only access |
| External Agency / Contractor | Time-limited, campus/channel-scoped access |

Permissions should be capability-based. Approval and publishing must be separable so a church can require two people for public posting.

### Ownership handover

Church assets and channel connections belong to the organization, not the person who created them.

The ownership-transfer workflow must include:

1. Current owner initiates transfer.
2. Successor verifies identity and accepts.
3. MFA or recovery verification for high-risk changes.
4. Cooling-off period with notifications to organization admins.
5. Review of billing contact, campuses, social credentials, active schedules, approval policies, and recovery contacts.
6. Immutable audit entry and confirmation receipt.
7. Safe rollback during the cooling-off window.

Offboarding must:

- Reassign owned tasks and pending approvals.
- Revoke sessions and time-limited links.
- Preserve historical actor display snapshots.
- Keep organization assets, brand kits, channels, and approvals intact.
- Flag social connections that rely on the departing user’s external permissions.

### Approval policies

Support:

- No formal approval, manual publishing only.
- One named or role-based approver.
- Pastor approval for sermon-derived content.
- Two-person approval for public publishing.
- Additional approval for sensitive categories: children, counselling, mental health, testimony, prayer requests, abuse, altar calls, or copyrighted worship content.
- Campus-specific approval chains.

Every approval records user, revision, timestamp, decision, and reason. Editing an approved asset creates a new revision and returns it to the required approval state.

---

## Target technical platform

The current content engine should be preserved and wrapped in a production SaaS control plane.

### Core architecture

1. **Identity and sessions**
   - Standards-based authentication.
   - MFA/passkeys.
   - Verified email and recovery.
   - CSRF/origin protection and session revocation.

2. **Tenant-aware control plane**
   - Central authorization policy used by pages, API routes, Server Actions, workers, exports, and publishing.
   - Postgres row-level security as defense in depth after application policies are stable.
   - Automated cross-tenant leakage tests.

3. **Private object storage**
   - Direct signed multipart uploads.
   - Checksums, resumability, size/duration limits, malware/media probing, quarantine, lifecycle policy, and tenant quota.
   - Short-lived signed previews; no public identifiers in permanent URLs.

4. **Durable asynchronous media platform**
   - Queue dependency graph.
   - Priorities, cancellation, retry policy, dead-letter queue, redrive, idempotency, and CPU/GPU resource classes.
   - Stateless workers reading/writing object storage.
   - No dependency on a user’s Mac or a single long-lived server.

5. **AI quality platform**
   - Versioned model, prompt, feature, and evaluation result.
   - Champion/challenger releases, canary, rollback, cost ceilings, and kill switches.
   - No silent theology drift from performance learning.

6. **Publishing orchestrator**
   - Organization-owned channel credentials.
   - Least-privilege scopes.
   - Credential expiry and reconnection.
   - Provider rate budgets, webhook deduplication, status reconciliation, immutable composition identity, and manual fallback.

7. **Audit, billing, and usage**
   - Append-only audit events.
   - Entitlement service independent of payment provider.
   - Durable usage ledger for sermon minutes, AI use, storage, seats, campuses, accounts, and publishing.

8. **Observability and recovery**
   - Structured logs, centralized errors, traces, metrics, alerts, and runbooks.
   - Correlation IDs across organization, user, sermon, job, asset, and scheduled post.
   - Backups, point-in-time recovery, object versioning, restore automation, and disaster drills.

### Security priorities

Immediate controls:

- Replace shared Basic Auth before multi-church use.
- Replace the shared worker bearer token with scoped workload identity and rotation.
- Add tenant scope to all data and object keys.
- Move credential encryption to managed key service with key IDs and tested rotation.
- Add CSP, HSTS, frame, referrer, and permissions policies.
- Add generalized rate limits and brute-force protection.
- Keep large media out of broad Server Actions; use the controlled upload path only.
- Enforce upload limits even when `Content-Length` is missing.
- Apply disk/capacity checks consistently.
- Allowlist supported URL import providers and isolate download workers from internal networks.
- Remove sensitive setup tokens from query strings.
- Remove runtime uploads and databases from source control.

### Privacy and ministry-specific trust

The product handles religious content, faces, voices, congregation footage, testimonies, prayer requests, minors, counselling references, and social credentials. It needs:

- Accurate privacy notices and data-flow explanations.
- Data classification and retention by asset class.
- Self-service export and deletion.
- Provider-side revocation and verifiable deletion receipts.
- Private archive garbage collection.
- DPA, subprocessor list, breach process, and international transfer position.
- POPIA readiness first, followed by GDPR/UK GDPR and applicable US privacy rules.
- Explicit controls for worship-music rights, minors, likeness, and sensitive pastoral content.

---

## Delivery organization

### Accountable leadership

| Role | Accountable outcome |
|---|---|
| CEO/CTO | Category, product thesis, capital allocation, launch gates, naming decision, and overall outcome |
| VP Product | Week Draft, activation, customer discovery, roadmap, and product metrics |
| VP Engineering | Architecture, delivery quality, reliability, cost, and security gates |
| Head of Design/Research | Pastor/volunteer usability, prototypes, design system, and accessibility |
| Head of AI/Media | Clip/content quality, evaluation, media pipeline, and cost-quality trade-offs |
| Head of Growth/Distribution | Activation, publishing, analytics, partnerships, and retention |
| Ministry Editorial Lead | Theological/context rubric, sensitive-content policy, and human evaluation |
| Head of Church Success | Pilot churches, onboarding, support insights, and customer education |

### Four delivery squads

#### 1. Trust Platform

**Staffing:** principal platform engineer, engineering manager, identity/security engineer, three full-stack engineers, QA/security automation engineer, fractional privacy counsel.

**Owns:** identity, organizations, campuses, RBAC, profiles, invitations, approval policy, handover, audit, billing, entitlement, privacy, tenant migration.

#### 2. Weekly Workflow

**Staffing:** product manager, senior product designer, design researcher, two front-end/product engineers, one full-stack engineer.

**Owns:** onboarding, Week Draft, Pastor Approval Inbox, Quick Finish, content state model, mobile workflow, accessibility, notifications, and handoffs.

#### 3. Media Intelligence

**Staffing:** applied AI lead, ML platform engineer, media pipeline engineer, applied AI engineer, ministry editorial lead, part-time review panel.

**Owns:** clip selection, content generation, transcript quality, Scripture/context integrity, title/hook quality, preview/render quality, framing, eval corpus, model release gates.

#### 4. Publishing and Growth

**Staffing:** product/growth manager, integrations engineer, backend engineer, data engineer/analyst, product engineer, SRE shared with Trust Platform.

**Owns:** social connections, calendar, preflight, dispatch/reconciliation, Planning Center and ingest integrations, analytics, outcomes, experiments, and recommendations.

### Credible initial headcount

- **Minimum private-alpha team:** 13–15 people.
- **Recommended beta/GA team:** 18–22 people.
- **Enterprise/global phase:** add SRE, compliance, partner engineering, enterprise success, and multilingual editorial capacity.

Do not staff four isolated feature teams. Squads share one Week Draft data model, one quality scorecard, one design system, and one release train.

### Ministry Advisory Council

Create a compensated council of 8–12 people:

- Small-church pastor with no media staff.
- Church communications director.
- Volunteer editor.
- Senior pastor/theology approver.
- Multi-campus communications leader.
- Youth/worship representative.
- Accessibility advocate.
- Leaders representing multiple denominations, accents, cultures, and languages.

The council does not replace customer research. It reviews policy, sensitive content, evaluation rubrics, and high-consequence automation.

---

## Phased roadmap

Timelines overlap intentionally, but launch gates do not.

### Phase 0 — Stabilize, instrument, and decide the name

**Timing:** Weeks 0–2

**Primary owners:** CEO/CTO, VP Engineering, VP Product, Security Lead, QA Lead
**Outcome:** A reliable baseline and a safe plan for changing the product.

#### Work

- Fix the Brand Kit client/server boundary and add a browser regression test.
- Update stale Playwright assertions and cover every critical route.
- Add an authenticated upload → Week Draft → review → prepare → schedule happy-path smoke.
- Add runtime route sweeps, visual regression for core breakpoints, axe/WCAG checks, and real-media fixtures.
- Add CI gates: lint, TypeScript, unit tests, migration validation, secret scanning, dependency review, SAST, build, and browser smoke.
- Define the product event taxonomy and baseline current funnel.
- Define initial SLOs, incidents, on-call ownership, and launch gates.
- Complete data-flow inventory, threat model, data classification, and tenant migration plan.
- Complete name/trademark/domain/SEO clearance.
- Recruit discovery participants and the first three pilot churches.
- Freeze new surface-area features unless they support this roadmap.

#### Exit gate

- Brand Kit works in production mode.
- All core routes pass browser smoke on desktop and mobile.
- CI is required for merge.
- Naming decision is made.
- Funnel instrumentation and baseline quality benchmark protocol are approved.
- Tenant migration and threat model are approved.

### Phase 1 — Church SaaS trust foundation

**Timing:** Weeks 2–10

**Primary owners:** Trust Platform and Media Reliability leads
**Outcome:** Multiple pilot churches can exist without sharing identity, data, credentials, media, billing, or permissions.

**Implementation status:** Phase 1A is implemented and verified; see
[Phase 1A — Trust Foundation Implementation](./phase-1a-trust-foundation-implementation.md)
for the shipped boundary and remaining launch gates.

#### Work

- Add users, profiles, identities, sessions, MFA, organizations, campuses, memberships, invitations, and recovery.
- Backfill all current data into a default organization before tenant keys become mandatory.
- Add organization scope to sermons, clips, jobs, brand settings, assets, AI invocations/cache, social accounts/credentials, posts, analytics, campaigns, outcomes, archives, and object keys.
- Implement centralized authorization and exhaustive permission-matrix tests.
- Add row-level security as defense in depth.
- Add basic entitlement and usage ledger before expensive processing is exposed to customers.
- Move upload ingress and durable media to private object storage.
- Promote current database jobs into a managed durable queue and stateless worker pool.
- Add append-only audit events.
- Implement safe invite, offboarding, and ownership-transfer foundations.
- Add production observability, backup, restore, and incident runbooks.

#### Exit gate

- Three pilot organizations can run concurrently.
- Automated tests prove one organization cannot enumerate, read, mutate, publish, export, or infer another’s data.
- Organization assets survive staff offboarding.
- A worker or web instance can disappear mid-job without lost work or duplicate publishing.
- Entitlements prevent unbounded AI/media consumption.
- Backup restoration and worker failure drills pass.

### Phase 2 — Week Draft autopilot and radical simplification

**Timing:** Weeks 4–14, behind feature flags until Phase 1 gate

**Primary owners:** Weekly Workflow and Media Intelligence
**Outcome:** Every sermon becomes one coherent, reviewable week without a second generation action.

#### Work

- Introduce the canonical `WeekDraft` and `WeekDraftItem` model.
- Automatically generate a mixed-format week when sermon intelligence completes.
- Merge the customer journey now spread across Content Ideas, Weekly Plan, and Ready to Post.
- Build the one-card Pastor Approval Inbox.
- Build Quick Finish with no more than eight controls.
- Keep Advanced Studio available but remove it from the default path.
- Guarantee preview generation before an item enters the review queue.
- Add title/hook fluency checks and block fallback/internal language.
- Make transcript verification selective and confidence-driven.
- Add church glossary, preferred Bible translation, names, locations, pronunciation/spelling, brand voice, and prohibited phrasing.
- Add YouTube channel monitoring and low-friction auto-import.
- Add exact provenance to every asset.
- Build progress, ETA, leave-and-return, and notification flows.

#### Exit gate

- Sermon completion creates a Week Draft automatically.
- Default pack produces 5–7 usable items across at least three formats.
- At least 99% of review items have a playable preview.
- Pastor Review has at most three primary actions per item.
- Median pastor review time is under eight minutes.
- Median human editing time per approved item is under two minutes.
- No raw enum, worker, environment, storage, or deterministic fallback copy appears in the customer UI.

### Phase 3 — Collaboration, approval, and handover

**Timing:** Weeks 10–20

**Primary owners:** Trust Platform and Weekly Workflow
**Outcome:** A real church team can move content from pastor to editor to publisher with accountability and safe succession.

#### Work

- Add assignments, owners, due dates, comments, mentions, change requests, and notification preferences.
- Replace synthetic `createdBy`/`approvedBy` strings with user identities and historical display snapshots.
- Add configurable approval policies and revision locking.
- Add a “What needs me today?” inbox.
- Add organization and campus roles, brand kits, channels, calendars, and approval routes.
- Add safe public review links with expiry, permission, watermark, and revocation.
- Add email/WhatsApp handoff receipts for churches using manual distribution.
- Complete ownership transfer, emergency recovery, and credential custody.
- Add activity timeline and audit export.

#### Exit gate

- A pastor can assign, request changes, and approve on mobile.
- An editor cannot publish unless explicitly authorized.
- A church can require two-person approval.
- A staff member can be removed and all open work reassigned without losing content or channel custody.
- Ownership transfer completes with verifiable audit history.

### Phase 4 — Reliable publishing and the church growth loop

**Timing:** Weeks 14–26

**Primary owners:** Publishing and Growth squad
**Outcome:** Approved content reaches the intended channel reliably and returns evidence that changes the next Week Draft.

#### Work

- Complete provider app reviews and reliable connection/reconnection UX.
- Prioritize Meta and YouTube reliability before broad platform count.
- Add centralized provider rate budgets, proactive token expiry, webhook receipts, and reconciliation.
- Make automatic vs manual publishing an organization policy.
- Build a suggested seven-day calendar from the approved Week Draft.
- Guarantee platform preview and scheduled payload identity.
- Preserve immutable composition and zero-duplicate publishing safeguards.
- Add Planning Center integration because it is already a competitive baseline.
- Prioritize verified ingest partners based on interviews: YouTube monitoring, Resi, BoxCast, StreamingChurch, Google Drive, or others.
- Add analytics ingestion and weekly learning report.
- Add privacy-conscious owned-link attribution and optional ministry outcome capture.
- Return short recommendations to the Week Draft rather than building a separate analytics report.

#### Exit gate

- Scheduled dispatch p95 is within two minutes when providers are available.
- Duplicate public posts attributable to SermonClip remain zero.
- Failed/revoked credentials produce a clear reconnect path and manual fallback.
- Scheduled payload is byte-for-byte or canonically identical to the approved preview contract.
- At least 70% of approved Week Drafts convert to three or more scheduled or completed handoff items in pilot churches.
- Growth recommendations cite their evidence and never rewrite theology.

### Phase 5 — Creative and intelligence moat

**Timing:** Months 6–12

**Primary owners:** Media Intelligence, Publishing and Growth, Enterprise Platform
**Outcome:** SermonClip becomes difficult to replace because it knows the church’s archive, standards, performance, and operating model.

#### Work

- Sermon archive knowledge graph: series, passages, topics, speakers, illustrations, prior assets, and performance.
- Citation-grounded search and chat over the archive.
- Duplicate-topic and content-fatigue prevention.
- Opt-in, privacy-preserving peer benchmarks.
- Champion/challenger model releases and per-church learning.
- Multilingual captions, graphics, and carefully governed translation/dubbing.
- Deeper Advanced Studio: reusable templates, keyboard editing, export to CapCut/Premiere/DaVinci, and expert controls.
- Multi-campus and denomination/network hierarchy.
- SSO/SAML, SCIM, custom roles, enterprise audit, legal hold, and regional controls.
- Public API, webhooks, service accounts, and partner marketplace.
- SOC 2 Type II evidence program and recurring penetration tests when customer demand justifies it.

#### Exit gate

- Archive answers always cite exact sermon evidence.
- Model releases cannot ship when quality, safety, latency, or cost regress beyond approved thresholds.
- Multilingual output has native-speaker review workflow and measured quality.
- Enterprise controls pass external security review.

---

## First 90 days: detailed operating plan

### Days 1–14

| Owner | Assignment | Deliverable |
|---|---|---|
| CEO/CTO | Make the category and naming decision | Signed category narrative and name-clearance decision |
| VP Product | Define the canonical Week Draft and activation funnel | PRD, state model, event taxonomy, prototype plan |
| Design/Research | Test the current and proposed workflow | 15 interviews, 8 observed workflow sessions, clickable prototype |
| QA Lead | Repair the browser quality gate | Updated smoke suite, Brand Kit regression, route/viewport matrix |
| Platform Lead | Produce tenant migration design | Entity map, backfill plan, authorization architecture, ADRs |
| Security Lead | Threat-model the full data path | Risk register, control plan, launch-blocking findings |
| AI/Media Lead | Define the benchmark | Corpus design, rubric, annotation guide, baseline run |
| Growth Lead | Establish measurement | Funnel dashboard and current activation baseline |
| Church Success | Recruit pilots | Three pilot churches and compensated advisory panel |

### Days 15–45

- Implement organization/user/session foundation.
- Backfill the current environment into one organization.
- Add required organization scope to the first vertical slice: sermon → clip → Week Draft → approval.
- Fix preview readiness and customer-facing fallback text.
- Prototype and implement Week Draft behind a feature flag.
- Implement one-card Pastor Approval Inbox and Quick Finish shell.
- Move new upload ingress toward signed object storage.
- Establish CI, error aggregation, tracing, queue/worker metrics, and alert ownership.
- Run the first blinded 24–40-sermon quality benchmark.
- Complete pricing research and cost-to-serve model.

### Days 46–90

- Complete the tenant-scoped vertical slice and authorization tests.
- Add roles, invitations, assignments, and one approval policy.
- Auto-generate the mixed-format Week Draft for pilot churches.
- Add YouTube channel monitoring for the pilot.
- Pilot the complete upload/import → Week Draft → review → Quick Finish → handoff path.
- Measure staff minutes, approval rate, edit rate, preview rate, failure rate, and return usage.
- Iterate weekly from observed sessions, not survey preference alone.
- Decide private beta readiness against the gates below.

### 90-day outcome

Three isolated pilot churches should be able to process a real weekly sermon and produce an approved mixed-format Week Draft with under ten minutes of total staff interaction, without cross-tenant risk and without entering Advanced Studio unless they choose to.

---

## Research program

### Customer research

Recruit at least 30 churches across:

- No media staff.
- Volunteer-led media.
- One communications employee.
- Larger church with specialized creative staff.
- Multi-campus church.
- Multiple denominations, cultures, accents, languages, and regions.

Required studies:

1. **Contextual inquiry:** observe the Monday-after-Sunday workflow.
2. **Artifact audit:** collect anonymized calendars, approval messages, templates, and handoff methods.
3. **Prototype testing:** compare current fragmented flow to Week Draft.
4. **Four-week diary study:** identify failure points across a real sermon cycle.
5. **Pricing interviews:** test willingness to pay against saved staff time and current tool stack.
6. **Churn interviews:** begin as soon as the first pilot pauses or abandons a week.

Do not ask only “Would you use this?” Measure what they do, how long it takes, who approves it, and where content currently dies.

### Competitive product testing

Use legitimate trials and publicly available workflows for:

- The same diverse sermon set.
- Time to first result.
- Publishable precision at top five suggestions.
- Editing minutes.
- Caption and framing quality.
- Mixed-format output.
- Team workflow and handover.
- Publishing reliability.
- Support and recovery.

Do not publish comparative claims until the test is blinded, repeatable, and reviewed legally.

### Sermon quality benchmark

Use 24–40 consented sermons spanning:

- Church size and denomination.
- Expository, topical, narrative, testimonial, and multilingual preaching.
- Gender, age, accent, pace, and speaking style.
- One speaker, multiple speakers, interpreters, panels, and altar calls.
- Sermon-only video and full services with worship/announcements.
- Fixed, wide, moving, low-light, and poor-audio sources.
- Sensitive testimony, minors, prayer, and pastoral-care content.

Measure:

- Precision@5 publishable suggestions.
- Complete thought and clean boundary rate.
- Meaning/theology preservation.
- Scripture reference accuracy.
- Church name and glossary error rate.
- Caption line breaking and safe-zone compliance.
- Speaker-framing failure rate.
- Preview availability.
- Median edit minutes.
- Render failure and recovery.
- Weekly-pack usefulness and format diversity.
- Sensitive-content false negative/positive rate.
- Post-publication retention, saves, shares, and owned-link follow-through where consented.

Every AI/model/prompt release should produce a scorecard with quality, latency, and cost deltas.

---

## Metrics and scorecard

### North star

> **Reviewed Content Weeks Published per Active Church per Month**

This measures the completed job, not generated clips.

### Activation

- Organization created → first sermon connected.
- First sermon → Week Draft ready.
- Week Draft → first item approved.
- First item approved → at least three items scheduled or handed off.
- Percentage of new churches completing the above within 48 hours.

### Quality

- Publishable precision@5.
- Week Draft item approval rate.
- Material edit rate.
- Median edit minutes per approved item.
- Meaning/context critical incident rate.
- Scripture/glossary error rate.
- Preview availability.
- Framing/caption/render defect rate.
- Duplicate/repetitive asset rate.

### Workflow and collaboration

- Median Pastor Review time.
- Approval turnaround.
- Assignment completion.
- Changes-requested cycles.
- Percentage using Quick Finish vs Advanced Studio.
- Handoff receipt/completion.
- Collaborating members per active organization.

### Publishing

- Approved-to-scheduled conversion.
- Scheduled-to-published completion.
- Dispatch lateness.
- Credential reconnect success.
- Manual fallback usage.
- Duplicate public posts.
- Platform preview/payload mismatch.

### Retention and business

- Weekly active churches.
- Week 4, 8, and 12 retained usage.
- Sermons processed per retained church.
- Gross margin per sermon and per published Week Draft.
- AI, rendering, storage, and support cost per active church.
- Trial-to-paid and plan expansion.
- Support contacts per processed sermon.

### Growth and ministry outcomes

Social metrics are diagnostic, not the mission:

- Watch time and completion.
- Saves and shares.
- Full-sermon follow-through.
- Website or event link clicks.
- Optional plan-a-visit, prayer request, group interest, message, testimony, or service-attendance outcome.

Do not claim SermonClip “grows churches” from reach alone. Report attributable actions and clearly distinguish correlation from causation.

### Initial product targets

These are planning targets to validate, not marketing claims:

- New admin reaches first upload in under five minutes.
- Week Draft requires zero extra generation action.
- Default pack yields 5–7 usable items across three or more formats.
- Preview availability before review: at least 99%.
- Median Pastor Review: under eight minutes.
- Median human edit time: under two minutes per approved item.
- Core mobile task reachable in the first viewport after necessary context.
- WCAG 2.2 AA on core paths.
- Control-plane availability: 99.9% monthly.
- Job acceptance durability: 99.9%.
- Scheduled dispatch p95: within two minutes when providers are available.
- Duplicate external posts attributable to SermonClip: zero.
- Initial RPO: 15 minutes; RTO: four hours.

---

## Pricing and go-to-market hypotheses

Do not commit to “unlimited” until cost-to-serve and abuse controls are measured.

### Acquisition

- First sermon free, no card.
- Accept a YouTube URL with minimal setup.
- Email the user when the Week Draft is ready.
- Let the user review meaningful output before requiring deep workspace configuration.
- Offer a guided “Sunday setup” service for the first sermon, brand kit, channels, and approval policy.

### Pricing hypotheses to test

| Segment | Hypothesis | What must be included |
|---|---:|---|
| Solo / small church | $29–$49/mo | Weekly sermons, core Week Draft, manual handoff, one brand/channel set |
| Growing team | $79–$129/mo | Team roles, approvals, scheduler, analytics, more channels/storage |
| Multi-campus | $249+/mo | Campuses, multiple brands/channels, custom policies, audit, priority processing |
| Network / enterprise | Custom | SSO, SCIM, hierarchy, API, legal/security controls, support |

Meter value-aligned constraints: sermon minutes, storage, channels, campuses, and advanced AI—not every generated caption or edit.

### Partnerships

Priority order:

1. YouTube channel monitoring.
2. Planning Center.
3. Livestream providers chosen from validated demand.
4. Google Drive/Dropbox-style ingest.
5. Export to CapCut, Premiere, and DaVinci.
6. Church management/engagement systems when outcome attribution is ready.

---

## What not to build yet

- Generic CapCut feature parity.
- Unreviewed public auto-publishing as the default.
- More dashboards before the Week Draft loop works.
- A generic sermon chatbot before citation-grounded archive quality is proven.
- A broad template marketplace before brand defaults and Quick Finish are excellent.
- More social networks before Meta and YouTube are reliable.
- AI music or stock B-roll without clear licensing and ministry-context policy.
- “Viral” optimization that changes the pastor’s meaning.
- Enterprise certifications before the underlying controls and customer demand exist.

---

## Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| Product name collision | Legal, SEO, support, and category confusion | Resolve in Phase 0 before acquisition spend |
| Cross-tenant data leak | Existential | Mandatory organization scope, centralized authz, RLS, isolation tests |
| Theological/context error | Pastoral harm and trust loss | Evidence provenance, selective human approval, eval corpus, release gates |
| Missing previews or machine copy | Immediate rejection of product quality | Preview-before-review gate and customer-copy validation |
| Overbuilding the editor | Delayed value and volunteer abandonment | Quick Finish default; Advanced Studio optional |
| Social API policy changes | Failed publishing | Reconciliation, credential lifecycle, manual fallback, limited promises |
| Media/AI cost blowout | Poor margins or abuse | Entitlements, usage ledger, quotas, cost dashboards, caching |
| Local worker/storage dependency | Reliability and scale failure | Private object storage and stateless durable worker platform |
| Sensitive data or rights misuse | Legal and reputational harm | Consent, retention, policy flags, privacy controls, rights guidance |
| Low adoption despite feature depth | Business failure | Observe real weekly workflows, measure staff minutes, pilot before scaling |
| Analytics encourages theology drift | Mission failure | Separate performance learning from editorial truth; no silent rewriting |
| Too many concurrent workstreams | Slow delivery | One Week Draft model, phase gates, quarterly outcome review, stop-work authority |

---

## Claims guardrails

Do not claim any of the following without direct evidence:

- “Best,” “#1,” “beats CapCut,” or “surpasses OpusClip.”
- “Viral.”
- “AI understands theology,” “theologically safe,” or “Scripture accurate.”
- Fixed transcription accuracy or processing time.
- A guaranteed complete week of content.
- A fixed number of hours saved.
- Causal church growth.
- “All platforms,” “fully automated,” or “zero touch.”
- “Your media never leaves your device.”
- SOC 2, enterprise-grade, GDPR compliant, or similar.
- Unlimited sermons or clips.
- “Trained on sermons” unless training data and method can be substantiated.
- Superior quality based only on vendor demos.

The product can earn strong claims through the benchmark, pilot data, security evidence, and attributable outcome reporting.

---

## Go/no-go gates

### Private alpha

- Brand Kit and all core routes work.
- Required CI and browser smoke pass.
- Three pilot churches are isolated.
- Week Draft is generated automatically.
- Preview availability is at least 99%.
- No critical cross-tenant finding is open.
- Every asset has source provenance.
- Human approval remains mandatory.

### Paid beta

- Identity, invitations, roles, audit, entitlement, deletion, and backup restore work.
- Upload/media processing no longer depends on a user device.
- Pastor Review and Quick Finish meet time targets.
- Billing and usage cannot drift silently.
- Support and incident ownership are staffed.
- Naming is legally and commercially cleared.

### General availability

- SLOs have at least eight weeks of evidence.
- Tenant isolation has independent security review.
- Quality benchmark passes approved thresholds across representative sermons.
- Publishing reconciliation and credential recovery are proven.
- Privacy documents match actual data flows.
- Three-month retention and gross-margin targets are understood.
- No open P0 security, quality, or data-deletion issue.

---

## Final strategic test

SermonClip surpasses the alternatives for churches only when this statement is consistently true:

> A church can connect Sunday’s sermon, review a faithful mixed-format week in minutes, hand it safely through pastor and media-team approval, publish without duplicate or accidental posts, and learn what to do next—without needing a professional editor or surrendering the meaning of the message.

That is the standard. Feature count is not.

---

## Research sources

Primary vendor and market sources used in the competitive work:

- [OpusClip pricing](https://www.opus.pro/pricing)
- [OpusClip plans and credits](https://help.opus.pro/docs/article/plans-and-credits)
- [OpusClip trust center](https://trust.opus.pro/?format=html)
- [CapCut long video to shorts](https://www.capcut.com/tools/long-video-to-shorts)
- [CapCut Teams benefits](https://www.capcut.com/help/benefits-of-capcut-teams)
- [CapCut Teams pricing guidance](https://www.capcut.com/help/capcut-teams-price)
- [ChurchSocial.ai Sermon Studio](https://www.churchsocial.ai/products/sermon-studio)
- [ChurchSocial.ai social media management](https://www.churchsocial.ai/products/social-media-management)
- [Pastors.ai product and pricing](https://pastors.ai/)
- [Sermon Shots features](https://sermonshots.com/features/)
- [Pulpit AI pricing](https://www.pulpitai.com/pricing)
- [Subsplash and Pulpit AI](https://www.subsplash.com/blog/more-church-media-plays-with-subsplash)
- [External Sermon Clips product](https://sermon-clips.com/)
- [External Sermon Clips pricing](https://sermon-clips.com/pricing)
- [Pulpit Engine](https://www.pulpitengine.com/)
- [The Pulpit App](https://thepulpit.app/)
- [Barna: churches and digital tools](https://www.barna.com/trends/churches-digital-tools/)
- [Pew Research: online religious services and sharing](https://www.pewresearch.org/religion/2023/06/02/online-religious-services-appeal-to-many-americans-but-going-in-person-remains-more-popular/)
- [Faith Communities Today technology report](https://faithcommunitiestoday.org/wp-content/uploads/2024/02/Technology-Report-Final.pdf)
