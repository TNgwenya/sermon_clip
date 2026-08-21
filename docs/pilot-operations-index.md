# Sermon Clip pilot operations

**Audience:** founder, pilot operator, technical responder, and each church's
named pastor/communications lead<br>
**Scope:** invite-only 5–10 church pilot<br>
**Status:** operating baseline to approve before the first church is onboarded

This pack defines the human operating controls around the pilot. It does not
claim that every control is automated, and it does not replace legal advice,
contracts, or a verified backup/restore process.

## Required operating documents

1. [Data, consent, retention, and deletion](./pilot-data-consent-retention-and-deletion.md)
   - what a church must confirm before upload;
   - the proposed pilot retention schedule;
   - how to close a deletion request across every known copy.
2. [Sunday operations runbook](./pilot-sunday-operations-runbook.md)
   - readiness checks, intake, processing supervision, safe fallbacks, and
     end-of-day evidence.
3. [Incident response and customer communications](./pilot-incident-response-and-customer-communications.md)
   - severity, roles, containment, evidence, escalation, and message templates.
4. [Phase 7 pilot measurement and decision support](./phase-7-pilot-measurement-and-decision-support.md)
   - exact journey definitions and denominators;
   - privacy-safe support effort, weekly review, and board export;
   - unknown/insufficient evidence rules and pilot stop conditions.

The technical backup inventory and restore drill are maintained separately by
the recoverability workstream. This pack references them but does not duplicate
or override them.

## Pilot roles

One person may hold more than one role during the pilot, but the assignment must
be written down for every Sunday.

| Role | Accountable for | Must not do alone |
| --- | --- | --- |
| Pilot owner | launch boundary, commercial decisions, church relationship, accepting residual risk | declare a privacy/security incident closed |
| Sunday operator | readiness checks, job supervision, incident logging, manual handoff | approve theology or publish on a church's behalf |
| Technical responder | diagnose application, worker, database, storage, and provider failures | inspect another church's content without documented incident need |
| Privacy lead | consent records, data requests, processor/provider coordination, legal escalation | make a legal conclusion without qualified advice |
| Church approver | pastoral accuracy, context, dignity, consent, and final content approval | share credentials or delegate approval informally |
| Church publisher | final platform/account/privacy check and publishing | publish an unapproved revision |

For application access, use the least-privileged product role. In particular,
pastoral approval and publishing are separate capabilities in the current role
model. An external contractor must have a scoped, time-limited assignment.

## Pilot operating boundaries

- Invite-only; start with five churches and expand only after the agreed gates
  pass for two consecutive Sundays.
- Use direct file upload as the dependable intake path. Treat third-party URL
  download as best effort and have the church retain the original file.
- Ask the church to select the sermon portion and keep the pilot workload to the
  agreed duration and usage allowance.
- Keep social publishing manual or private during the pilot. The posting worker
  defaults are protective, but configuration must be verified rather than
  assumed.
- A human church approver reviews transcript wording, context, names, Scripture,
  testimony, people shown, and the exact media revision before publication.
- Do not describe basic time-window fallback clips as pastorally reviewed or
  AI-validated suggestions.
- Do not promise email notifications until delivery has been tested end to end.
  Maintain a manual phone/WhatsApp/email contact tree.
- Do not promise complete deletion, a recovery point, or a recovery time until
  the inventory and restore drill have produced evidence for the deployed
  environment.

## Before admitting the first church

- [ ] Pilot owner and church authorized representative sign the pilot terms and
      data-processing/consent schedule reviewed for the relevant jurisdictions.
- [ ] Church names a primary approver, backup approver, publisher, and urgent
      contact.
- [ ] Operator records the environment, storage locations, subprocessors, and
      deployed retention settings without recording secrets.
- [ ] Privacy policy and in-product deletion wording are reconciled with the
      deployed architecture. The current policy still describes a primarily
      local-Mac arrangement, while the repository also supports private S3
      source upload, worker-local media, R2 previews/publishing media, and a
      separate private archive.
- [ ] Cross-tenant application and media denial tests pass.
- [ ] Backup inventory and isolated restore drill pass.
- [ ] Sunday and incident contact trees are tested.
- [ ] Publishing remains manual/private until the church and pilot owner
      explicitly approve a connector-specific live test.

## Evidence and review cadence

Use a pilot operations register that contains identifiers and outcomes, not
sermon text or credentials. At minimum record:

- date/time in UTC and local church time;
- church/workspace identifier and sermon identifier;
- consent/rights confirmation reference;
- processing start, first useful result, completion, retry, and failure times;
- approval and publishing revision identifiers;
- incidents, deletion requests, and restore drills by ticket/incident ID;
- customer communication times and owner;
- exceptions and the person who accepted them.

Review the register after every Sunday and weekly during the pilot. The pilot
owner, privacy lead, and technical lead should conduct a formal gate review
before adding churches or enabling a new publishing connector.

The internal register and the Phase 7 board export serve different purposes.
Keep identifiers in the access-controlled operating register only where they
are operationally necessary. The board export must remain anonymous aggregate
evidence with no sermon text, private notes, user identities, or resource IDs.
