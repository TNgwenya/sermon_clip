# Sermon Clip Premium Studio UI/UX Audit

Date: 2026-07-09

## Executive summary

Sermon Clip already has the capability and ministry-specific language of a serious content platform. The current experience, however, presents too much capability at equal visual weight. Dense workflow pages, repeated statuses, technical progress detail, small video previews, nested bordered panels, and broad navigation make the product feel like an internal operations console rather than a calm premium sermon content studio.

The highest-value direction is not a business-logic rewrite. It is a clearer product hierarchy built around one guided journey:

**Add sermon → Analyze → Review moments → Edit and brand → Prepare and post**

Video should be the hero. AI should explain why a moment was chosen. Every screen should make one next action unmistakable, while recovery and diagnostic controls remain available through progressive disclosure.

## 1. Current product experience problem

The core journey exists and is functional, but it is fragmented across dense surfaces:

- The dashboard combines operational priority, fast import, metrics, background work, top clips, and recent sermons at similar visual weight.
- Intake asks for source, metadata, trim settings, rights, and coming-soon integrations before establishing a clear source-first flow.
- Processing mixes useful user progress with transfer details, polling language, inferred percentages, and raw worker signals.
- Review cards expose video, selection, multiple quality/status labels, transcript warnings, approval controls, editing, rejection, and production actions together.
- Clip Studio puts transcript, preview, timeline, readiness checks, audio, captions, hook, framing, branding, post copy, and diagnostics into one competing workspace.
- Ready to Post combines asset selection, preview, platform copy, downloads, scheduling, a two-week calendar, support, and history.

This makes the product powerful but cognitively expensive. It weakens trust because technical state can look more important than the message being prepared.

## 2. Top UI/UX weaknesses

### Information architecture

- Eight equally weighted navigation destinations compete with the primary sermon-to-post workflow.
- Navigation has no active-route state in the original shell.
- Supporting areas such as Growth, Ideas, technical social setup, and insights are presented alongside core work.
- Mobile navigation becomes a crowded horizontal strip.

### Visual system

- `src/app/globals.css` contains 12,769 lines, two root palettes, duplicated Studio rules, many close breakpoints, and extensive hard-coded values.
- Tonal hierarchy is weak because most regions use the same dark rectangle, border, and 8px radius.
- Cards, status pills, buttons, and explanatory copy are overused.
- Typography depends on platform-specific fallbacks and many one-off sizes.
- Several supporting labels are too small for comfortable reading.

### Workflow clarity

- Many screens expose several valid actions without establishing one recommended next step.
- Quality state, workflow state, media freshness, and operational state compete visually.
- AI suggestions often look like scores and system metadata rather than editorial recommendations with reasons.
- Long-running states imply more precision than the backend always provides.

### Resilience and accessibility

- The original app has no route-level loading, error, or not-found experiences.
- Reduced-motion behavior is absent despite animated progress and skeleton states.
- Original mobile navigation targets are too small.
- Studio tabs lack complete keyboard interaction and panel relationships.
- Some modal, timeline, and drag interactions still need a later accessibility pass.

## 3. Biggest opportunities to feel premium

1. Make video and sermon imagery the main source of visual energy.
2. Use a restrained warm-obsidian and graphite palette with soft ivory text and one sage accent.
3. Replace border-heavy nesting with tonal depth, spacing, and selective elevation.
4. Give every screen one dominant next-best action.
5. Present AI output as a recommendation, reason, confidence, and evidence.
6. Keep diagnostics and uncommon recovery actions behind purposeful disclosures.
7. Use a consistent five-stage workflow across Home, intake, Review, Studio, and publishing.
8. Design mobile around a focused bottom navigation and video-first stacking.

## 4. Screens and components needing the most attention

### Highest priority

- Root application shell and navigation
- Shared typography, buttons, surfaces, badges, notices, and feedback states
- Dashboard first viewport
- Sermon upload/import
- Sermon processing
- Suggested clip review
- Clip Studio responsive layout and inspector hierarchy
- Ready-to-Post selection and preparation flow

### Next priority

- Framing controls and direct focal-point editing
- Brand Kit and Studio branding alignment
- Social account setup language
- Growth/Ideas/Insights consolidation
- Modal focus management
- Keyboard alternatives for drag and timeline interactions

## 5. Proposed visual direction

The visual concept is **quiet chapel meets professional edit suite**:

- Warm obsidian canvas rather than pure black
- Layered graphite surfaces
- Soft ivory primary text and stone secondary text
- Desaturated sage-teal for current, recommended, and ready states
- Amber only for review states and coral only for failures or destructive actions
- Editorial display typography for sermon and page titles; restrained sans-serif for controls
- Tabular numerals for timecodes and progress values
- 4/8/12/16/24/32/48/64 spacing rhythm
- 8–10px controls, 12–14px panels, and 16–18px media/hero surfaces
- 44px minimum interactive targets
- Tonal separation and whitespace instead of borders around every region

Recommended global workflow language:

- Draft
- Analyzing
- Ready to review
- Approved
- Preparing
- Ready to post
- Posted
- Needs attention

Quality remains separate:

- Strong moment
- Review context
- Needs edit

## 6. Proposed workflow improvements

### Dashboard

- Lead with one current task and one fast import path.
- Place strongest visual clips before operational metrics.
- Keep metrics as a quiet studio summary.
- Use product language such as “Your sermon content studio,” not “command center.”

### Upload/import

- First choose a link or local recording.
- Then add sermon details.
- Keep service trim and alternate integrations secondary.
- Explain what analysis produces and that human approval remains central.

### Processing

- Show the current pastoral-language stage and what happens next.
- State clearly that the user may leave the page.
- Keep exact transfer details in a disclosure.
- Use honest indeterminate states whenever exact progress is not available.

### Review

- Default card content: large video, title/hook, one quality state, one “Why this moment” explanation.
- Primary decision: Approve or Edit in Studio.
- Keep rejection, transcript evidence, diagnostics, and production controls secondary.
- Make batch selection purposeful and less dominant.

### Clip Studio

- Keep live video as the visual hero.
- Use a quiet header with one current status and collapsible checks.
- Adapt to two columns before the preview and inspector become cramped.
- Keep all editor panels mounted to preserve draft state.
- Support full keyboard tab navigation.
- Continue toward simpler task stages: Trim, Captions, Frame, Brand, Post.

### Ready to Post

- Make the flow explicit: Choose clip → Prepare post → Download or schedule.
- Keep the selected video and platform copy together.
- Separate calendar and publishing history from the primary preparation task.
- Preserve preparation recovery, downloads, scheduling, and account handoff logic.

## 7. Prioritized implementation plan

### P0 — Foundation and core first impression

- Establish semantic design tokens and premium shell.
- Add grouped active navigation and mobile bottom navigation.
- Add route-level loading, error, and not-found states.
- Add reduced-motion, focus, contrast, and touch-target improvements.
- Redesign Dashboard and sermon intake.

### P1 — Core production workflow

- Simplify processing hierarchy and technical detail.
- Recompose Review around video, rationale, and the decision.
- Make Studio preview-first and fix medium-desktop/tablet overflow.
- Recompose Ready to Post around selection, preparation, and completion.

### P2 — Product consolidation

- Consolidate on-video captions, hooks, social copy, titles, and hashtags into a clearer content model.
- Simplify framing around output format and recommended crop.
- Align Studio branding with saved Brand Kit defaults.
- Move Growth, Ideas, Knowledge, health, and technical connector diagnostics into a secondary Insights/Settings architecture.
- Gradually decompose the legacy global stylesheet after stable visual regression coverage exists.

## Business-logic guardrails

The presentation work must preserve:

- Upload field names and server action parsing
- `useFormStatus` placement inside the upload form
- Review approval and transcript-readiness gates
- `ClipStudioPreviewProvider` around the full Studio surface
- Mounted Studio tab panels and their shared draft state
- Caption, framing, branding, edit-plan, render, export, and preparation payloads
- Ready Queue selection, focus, downloadable media, scheduling, and recovery state

The implemented premium pass follows those guardrails and changes presentation hierarchy rather than the media pipeline.
