# Pilot incident response and customer communications

**Scope:** Sermon Clip invite-only pilot<br>
**Owner:** named incident commander<br>
**Related:** [Sunday operations](./pilot-sunday-operations-runbook.md) and
[data/consent/deletion](./pilot-data-consent-retention-and-deletion.md)

This runbook is operational guidance, not legal advice. Suspected compromise,
personal-information exposure, children/safeguarding material, contractual
notification, and cross-border/provider issues require the privacy lead and
qualified advice. Under POPIA, an operator should notify the responsible party
immediately where there are reasonable grounds to believe personal information
was accessed or acquired by an unauthorized person; the responsible party's
Information Regulator and data-subject duties need case-specific advice. Do not
wait for complete certainty before escalating internally.

Authoritative references reviewed for this operating baseline:

- [Protection of Personal Information Act 4 of 2013](https://www.gov.za/documents/protection-personal-information-act)
- [Information Regulator fact sheet: handling security compromises](https://inforegulator.org.za/2025/08/19/fact-sheet-handling-of-security-compromises/)
- [Information Regulator eServices portal](https://eservices.inforegulator.org.za/services.aspx)

The Information Regulator's current fact sheet says the responsible party
reports all security compromises irrespective of its risk assessment and that
an operator notifies the responsible party. The privacy lead must check the
current official procedure at incident time rather than relying only on this
runbook.

## 1. Incident roles

Assign roles in the incident record. One person may cover several roles, but an
incident involving customer data must have a separate reviewer before closure.

| Role | Decision/accountability |
| --- | --- |
| Incident commander (IC) | severity, containment authority, cadence, owner assignment, closure |
| Technical responder | diagnosis, safe containment/recovery, system timeline |
| Privacy/security lead | exposure assessment, evidence limits, responsible-party/provider/legal escalation |
| Pastoral safety lead | context, dignity, testimony/minor/safeguarding response, takedown decision with church |
| Customer communications lead | single accurate church-facing voice and update log |
| Scribe | timestamped decisions, actions, evidence locations, communications |

The affected church's named authorized contact and pastor approver are part of
the response, but do not receive another church's information.

## 2. Severity and response targets

Targets start when the first team member becomes aware. They are internal pilot
targets, not contractual or statutory claims.

| Severity | Examples | Acknowledge / IC | Contain or workaround target | Update cadence |
| --- | --- | --- | --- | --- |
| **SEV-1 Critical** | cross-tenant data/media access; leaked credentials or signed URLs with material exposure; unapproved/public sensitive clip; destructive loss; active compromise | 15 min / 15 min | 30 min | every 30 min; affected church initial notice as soon as facts/contact are validated, target within 1 hour |
| **SEV-2 Major** | a church cannot process its Sunday sermon; repeated failures across churches; database/storage/worker outage; restore required; publishing result unknown or wrong but not sensitive/public | 30 min / 30 min | 2 hours or agreed manual path | hourly |
| **SEV-3 Degraded** | one stage/connector fails with safe manual alternative; delayed result; isolated incorrect suggestion caught before release | 4 business hours / same business day | next business day | at material change and daily |
| **SEV-4 Request/defect** | cosmetic issue, ordinary how-to, enhancement, non-urgent deletion/rights request | 2 business days | scheduled/triaged | agreed ticket cadence |

Raise severity when impact, affected scope, sensitivity, publication, duration,
or uncertainty increases. Lower severity only with IC and privacy/pastoral lead
agreement recorded in the incident.

## 3. First 15 minutes

### Identify and protect

- [ ] Create incident ID `SC-YYYYMMDD-NNN`, start a UTC and SAST timeline, name
      IC and scribe.
- [ ] Record reporter, affected church/workspace, sermon/job/object/post IDs,
      first known time, symptom, and current exposure. Use identifiers, not
      content, where possible.
- [ ] For cross-tenant/privacy suspicion, stop using the affected route/object
      and prevent new affected intake/publishing. Do not browse other churches
      to estimate scope.
- [ ] For an unapproved/sensitive live post, coordinate immediate provider-side
      hide/unpublish with the church publisher and preserve minimal evidence.
- [ ] For credential compromise, revoke at the provider first, then rotate
      through the approved secret process. Never paste the credential into the
      incident record.
- [ ] For possible data loss, stop deletion/retention/pruning and protect current
      backups/inventory. Do not run a production restore.
- [ ] Keep automatic publishing private/dry-run or pause the affected connector;
      use manual download only when the approved artifact is known safe.

### Establish facts

- [ ] What happened versus what is inferred?
- [ ] Which tenant, user, resource, object key, revision, connector, worker, and
      provider are involved?
- [ ] Was data merely accessible, actually accessed, downloaded, altered,
      deleted, or published? Mark unknowns explicitly.
- [ ] Is a child, testimony, counselling, health, financial, authentication, or
      social-token category involved?
- [ ] What was the last known good state and change/event immediately before it?
- [ ] Is there a safe church workflow still available?

## 4. Evidence handling

Preserve enough evidence to answer what happened without creating another leak.

- Use a restricted incident folder/ticket with access limited to assigned
  responders.
- Preserve relevant application/audit/job IDs, UTC timestamps, deployment
  version, configuration **names and boolean states** (not values), provider
  request IDs, object keys where access-controlled, response codes, and hashes.
- Export the smallest relevant log interval. Redact tokens, signed query
  strings, cookies, authorization headers, email addresses, transcript text,
  faces, and testimony.
- If a screenshot is essential, crop/redact it and record who captured/accessed
  it. Prefer structured status records.
- Record every query or temporary access to customer content and why it was
  necessary. Use a synthetic reproduction wherever possible.
- Do not delete, edit, or “clean up” relevant evidence while the investigation
  or legal hold is active. Containment may remove public access while retaining
  a restricted evidentiary record approved by the privacy lead.

## 5. Incident-specific playbooks

### Cross-tenant application or media access

1. Treat as SEV-1 even if observed in a test account.
2. Stop the implicated route, media link, or operation and new pilot intake;
   preserve service availability for demonstrably unaffected manual workflows
   only with IC approval.
3. Record the requesting tenant/user and requested/returned tenant/resource IDs.
4. Do not enumerate tenants, buckets, or rows from a general-purpose production
   console. Use scoped logs/tests or a sanitized snapshot.
5. Determine accessible versus accessed scope separately.
6. Notify the responsible church party and obtain privacy/legal guidance; never
   reveal another church's identity unnecessarily.
7. Require application and object-access denial regression tests before
   reopening. Review logs for the exposure window and record residual unknowns.

### Unfaithful, unsafe, or private pastoral content

1. Stop scheduling and publishing; if live, ask the authorized church publisher
   to hide/remove it immediately.
2. Preserve the sermon, transcript, clip revision, approval history, and
   provider/post identifiers under restricted access.
3. Involve the church approver and pastoral safety lead. Do not ask ordinary
   support staff to judge theology, testimony consent, or safeguarding.
4. Identify whether the issue came from transcript wording, translation,
   selection/context, edit, caption, approval mismatch, or wrong revision.
5. Correct only through a new revision and fresh church approval. Do not silently
   replace the approved artifact.

### Worker/processing/provider outage

1. Confirm application/database, media worker heartbeat/claim, storage reserve,
   source access, AI quota/provider, and affected job state.
2. Avoid duplicate submissions. Retry once only after identifying a transient
   condition or corrective action.
3. Prioritize one safe top clip per church; use direct upload and manual
   publishing fallbacks.
4. If the worker is stale, follow the approved restart procedure and verify a
   fresh heartbeat before declaring recovery.
5. If multiple churches are affected or the Sunday result is missed, treat as
   SEV-2 and measure operator/rework cost.

### Data loss or restore need

1. Stop writes/deletion/retention affecting the resource and preserve inventory.
2. Identify last known good database and media copies and their timestamps.
3. Run only the documented restore drill in an isolated environment. A
   production restore requires a separate approved change plan, backup of the
   current state, tenant/media reconciliation, and pilot-owner authorization.
4. Validate database-to-media references, tenant ownership, hashes, approvals,
   and publishing state before any cutover.
5. Tell customers the verified recovery point and gaps; do not infer them from a
   provider “backup enabled” badge.

### Social publishing incident

1. Verify the exact connected account, selected media revision, copy, privacy,
   provider post ID, and platform-visible result.
2. Cancel queued jobs and revoke a suspect connection where authorized. Keep
   other connectors manual/private.
3. “Accepted,” “uploaded privately,” or a queued state is not the same as a
   verified public post. Communicate the observed state precisely.
4. Wrong-account, public-sensitive, or unapproved posting is SEV-1; an ordinary
   failed upload with a safe manual alternative is normally SEV-3.

## 6. Escalation matrix

| Trigger | Immediate escalation |
| --- | --- |
| Personal information/cross-tenant access | IC, privacy/security lead, pilot owner, affected church authorized contact, qualified legal/Information Officer review |
| Child/safeguarding/private pastoral disclosure | IC, pastoral safety lead, church safeguarding lead, privacy lead; emergency services only where appropriate and authorized by policy/law |
| Credential/token/session compromise | IC, security/technical responder, credential owner/platform administrator, affected church |
| Suspected destructive loss/restore | IC, technical and recoverability owner, pilot owner, affected church; vendor support as required |
| Multi-church outage or missed Sunday deliverable | IC, technical responder, pilot owner, affected churches on separate communications |
| Social platform wrong account/publication | IC, church publisher/account owner, privacy and pastoral leads based on content |
| Threat/extortion/media inquiry | pilot owner and qualified legal/communications advice; operators do not respond independently |

If the primary contact does not acknowledge a SEV-1 within 10 minutes, use the
backup channel and next named contact. Keep each church's communications
separate.

## 7. Customer communications

Use the church's agreed urgent channel plus an email/ticket record. Be direct,
pastoral, and factual. State times with timezone. Do not speculate, assign blame,
expose another tenant, quote sensitive sermon content, or promise legal outcomes.

### Initial notice

> **Subject:** Sermon Clip incident affecting [church/workflow] — [incident ID]
>
> At **[time, timezone]** we identified **[verified symptom]** affecting
> **[scope known to this church]**. **[Nothing has been published / observed
> publishing state]**. We have **[containment action]** and are checking
> **[areas]**. We do not yet know **[material unknowns]**. Your immediate action
> is **[action or “none”]**. Our next update will be by **[time]**. Your incident
> contact is **[name/channel]**.

### Progress update

> Since **[last update]**, we confirmed **[facts]** and ruled out **[facts]**.
> The current impact is **[scope]**. We have completed **[actions]** and are now
> **[next action]**. **[Safe/manual alternative]** remains available. Please
> **[customer action]**. Next update: **[time]**.

### Resolution

> Service/workflow was restored at **[time]** and we verified **[customer-visible
> checks]**. The incident affected **[scope]** from **[start]** to **[end]**.
> We took **[containment and correction]**. Remaining follow-up is **[work and
> date]**. Please **[rotate/review/remove/republish action]**. We will provide a
> plain-language review by **[date]**.

For a privacy/security case, have the privacy/legal owner approve any notice
that discusses data categories, people affected, regulator duties, or risk. Do
not delay the responsible party's urgent awareness while polishing a complete
root-cause report.

## 8. Recovery, closure, and review

An incident may close only when:

- [ ] containment is stable and the affected workflow is disabled or verified;
- [ ] customer-visible recovery has been tested in the correct tenant;
- [ ] application and media isolation tests pass after an isolation issue;
- [ ] no unowned jobs, posts, deletion tasks, or exposed links remain;
- [ ] affected churches received a resolution or agreed next update;
- [ ] privacy/pastoral/legal follow-up and provider tickets have owners/dates;
- [ ] evidence is access-controlled with a retention/hold decision;
- [ ] metrics record detection, acknowledge, contain, recover, and communicate
      times; retries/rework and support hours are captured;
- [ ] IC and an independent privacy/technical reviewer approve closure.

Hold a blameless review within 3 business days for SEV-1 and 5 business days for
SEV-2. Document root cause, contributing conditions, why safeguards did or did
not detect it, customer impact, what is still unknown, corrective actions with
owners/dates, and the test or drill that prevents recurrence. Reopen the pilot
gate when the action is evidenced, not merely assigned.
