# Sermon Clip UI/UX Audit

Date: 2026-06-30

## Scope

Reviewed the live Next app at `http://localhost:3009` across desktop and representative mobile widths. Pages reviewed:

- `/`
- `/sermons/new`
- `/sermons`
- `/sermons/[id]`
- `/sermons/[id]/review`
- `/sermons/[id]/intelligence`
- `/sermons/[id]/clips/[clipId]/studio`
- `/ready-to-post`
- `/growth`
- `/settings/social`
- `/settings/branding`
- `/opportunities`
- `/health`
- `/intelligence-dashboard`
- `/knowledge-base`
- `/privacy`
- `/terms`
- `/data-deletion`

## Overall Read

The app has a strong product idea and a distinctive dark media-workspace visual direction. It feels like a serious operating desk for sermon clips, not a generic admin panel. The best parts are the command-center home, visual clip cards, real video previews, and the clear ministry-oriented vocabulary.

The main UX problem is not lack of features. It is that many screens expose too much at once. The app often explains every system state, every supporting action, and every metric at the same visual weight. That makes it feel powerful, but also heavier and less beautiful than it could be.

## Priority Findings

### P0: Fix the sermon intelligence fallback layout

Route: `/sermons/[id]/intelligence`

When the sermon has no transcript, the page renders outside the usual `main` workspace structure. It lacks the consistent card/header treatment used elsewhere and visually feels unfinished.

Recommended fix:

- Wrap the page in a semantic `main`.
- Use the same page shell as the other sermon pages.
- Turn the missing-transcript state into a proper empty/action state.
- Add one primary action, for example `Transcribe sermon` or `Back to sermon`.

### P1: Reduce equal-weight actions on workflow pages

Routes most affected: `/ready-to-post`, `/growth`, `/sermons/[id]/review`, `/sermons/[id]/clips/[clipId]/studio`

The app often shows 4-10 actions in the first screen or inside repeated cards. Users need one recommended action and then secondary actions.

Recommended fix:

- Use one primary button per major screen section.
- Move rarely used actions into a compact secondary row or details menu.
- Rename action groups around user intent, not system capability.
- Prefer `Next best action` treatment on pages where users may be unsure.

Example:

- Current: `Check now`, `Previewing`, `Refresh media`, `Edit clip`, `Open TikTok`, `Copy caption`, `Copy hashtags`
- Better grouping:
  - Primary: `Refresh media`
  - Secondary: `Edit clip`, `Copy caption`
  - External: `Open TikTok`

### P1: Make Growth a cockpit, not a long report

Route: `/growth`

This page has the highest density: roughly 1,000+ visible words, 70+ card-like elements, and 10 forms/actions areas. It contains valuable ideas, but the first impression is a report rather than a focused growth workflow.

Recommended fix:

- Split into tabs or sections: `Recommendations`, `Channels`, `Campaigns`, `Analytics`.
- Keep the first viewport to one recommendation, one forecast, and one action.
- Move `Trend discernment`, `Historical baseline`, `Prediction vs actual`, and `Learning loop` below tabs or into collapsible panels.
- Shorten the hero description.

Suggested hero copy:

- Current: `Use sermon clips, platform signals, event timing, and guardrails to decide what to post next, why it matters, and what impact to expect.`
- Better: `Choose the next post, forecast its reach, and keep ministry guardrails visible.`

### P1: Simplify repeated explanatory copy

Affected globally.

Most pages include a title, subtitle, card title, card description, and helper text. This becomes wordy when all layers say similar things.

Recommended fix:

- Keep page subtitles short.
- Remove descriptions under obvious cards.
- Use helper text only where it changes a decision.
- Prefer direct labels over explanatory sentences.

Examples:

- `Automatic work currently happening in the background.` can become `Background work`.
- `The app will guide you to review clips when processing finishes.` can be removed unless there is active processing.
- `Post-ready is different from merely having a preview.` is useful, but should be near the exact status legend, not as a section description.

### P1: Improve mobile first-screen action flow

The mobile layout does not overflow horizontally, which is good. The issue is vertical priority. On mobile, the top rail consumes space, hero actions wrap awkwardly, and key content starts lower than it needs to.

Recommended fix:

- Convert the mobile rail into a compact bottom nav or horizontal tab bar with fewer items.
- Hide the rail footer on mobile.
- Limit hero actions to one primary and one secondary action.
- Collapse tertiary actions under `More`.

## Visual Design Recommendations

### Keep the dark media-workspace direction

The black surface, white primary buttons, cyan accents, and video-first cards fit the product. It feels closer to a creator tool than an admin dashboard, which is good.

Improve beauty by reducing visual noise:

- Fewer cards nested inside cards.
- Fewer border boxes inside already bordered panels.
- More whitespace around primary content.
- Stronger contrast between primary action areas and informational panels.
- Use video/clip thumbnails as the main visual anchors, not metrics everywhere.

### Use cards more selectively

Current card usage is very high, especially on home, growth, health, and studio. Cards should frame repeated items, primary tools, and decision panels. Plain sections can be unframed.

Recommended fix:

- Keep cards for clip items, forms, and modals.
- Remove card styling from explanatory wrapper sections.
- Avoid card-inside-card structures where possible.

### Make status language calmer and more consistent

The app has many statuses: `Ready`, `Ready to post`, `Preview ready`, `Prepared`, `Planned`, `Needs editing`, `Needs media refresh`, `Needs repair`, `Good`, `Score`.

Recommended fix:

- Define a small global status vocabulary:
  - `Ready`
  - `Needs review`
  - `Needs repair`
  - `Processing`
  - `Posted`
- Use quality labels separately:
  - `Post-ready`
  - `Review first`
  - `Needs edit`

## Page-by-Page Notes

### Home

Strengths:

- Strong first impression.
- Clear command-center concept.
- Clip thumbnails make the app feel real.

Issues:

- The hero has three actions, then the priority card has another primary action, then quick start has another. Too many first-screen choices.
- The priority card headline is very large for a repair state.
- Metric cards add density before the user reaches the actual clips.

Recommended changes:

- Keep `Create clips` as the hero primary and move `Growth cockpit` lower.
- If something needs attention, make the repair card the primary task and reduce hero actions.
- Shorten section descriptions.

### Create Sermon

Strengths:

- Good promise: one sermon to polished clips.
- Workflow strip helps set expectations.

Issues:

- The page mixes intake form, import options, workflow explanation, and decorative preview.
- `Start with one sermon. Leave with polished clips.` is strong but marketing-like for an internal tool.

Recommended changes:

- Focus the top screen on the form.
- Move import options below the primary link/upload path.
- Shorten hero to `Create clips from one sermon`.

### Sermon Library

Strengths:

- Useful filters and clear featured sermon.
- Good operational view.

Issues:

- `Review retry` is awkward wording.
- Featured card and list repeat the same sermon information.

Recommended changes:

- Rename `Review retry` to `Fix issue`.
- If there is only one sermon, reduce repetition and show the list as supporting content.

### Sermon Detail

Strengths:

- Good overview of a sermon workflow.
- Links to review, insights, and ready-to-post are discoverable.

Issues:

- The page uses a lot of explanatory copy before showing the clip list.
- The user may not know whether to go to review, studio, or ready-to-post first.

Recommended changes:

- Add a single `Next step` panel.
- Place clip cards earlier.
- Shorten operational descriptions.

### Pastor Review Feed

Strengths:

- Strong use of video thumbnails.
- Good approve/reject workflow.
- List view works well for scanning.

Issues:

- Every clip card repeats many controls.
- `Approved`, `Reject`, `Needs review`, `Edit clip`, and `Open post queue` compete visually.
- Metadata like `0:45 durationChurch members and visitorsReady` appears visually compressed.

Recommended changes:

- Keep per-card primary action as `Edit clip` or `Review`.
- Move approve/reject into a compact decision cluster.
- Add spacing/separators to metadata.
- Collapse `Text and production tools` by default, which already partly happens.

### Sermon Intelligence

Strengths:

- The concept connects sermons to reusable ministry knowledge.

Issues:

- Missing transcript state looks unstyled compared with the rest of the app.
- It lacks the usual `main` surface.

Recommended changes:

- Treat it as a polished empty state with a primary action.
- Add consistent navigation back to the sermon.

### Clip Studio

Strengths:

- This is the most impressive product surface.
- Live preview and editing controls feel valuable.
- The video is the right visual anchor.

Issues:

- The editor has too many controls visible at once.
- Preview, intelligence, timing, cleanup, captions, style, hook, output, branding, and evidence all appear in one long flow.
- Some button labels are too technical or too small-context: `-0.25s`, `Snap to spoken lines`, `Burn-in on`.

Recommended changes:

- Keep preview sticky on desktop.
- Make tabs stronger: `Edit`, `Style`, `Export`, `Evidence`.
- Hide advanced timing controls until `Fine tune timing` is opened.
- Use labels like `Move start earlier` in tooltips for timing buttons.

### Ready To Post

Strengths:

- This page has a clear job: copy captions, download clips, schedule posts.
- The preview/post split is conceptually right.

Issues:

- Many action types are visible together: download, preview, refresh, edit, copy, schedule, post, mark, skip.
- The selected clip sidebar and main preview duplicate readiness messaging.
- On mobile the page becomes very long before scheduled posts.

Recommended changes:

- Use a three-step flow: `Choose clip`, `Prepare post`, `Schedule/send`.
- Make `Refresh media` the only primary action when media is missing.
- Hide platform caption tabs until the media is usable.

### Growth

Strengths:

- Strong ministry-specific product idea.
- Recommendations, forecasts, guardrails, campaigns, and outcomes are valuable.

Issues:

- Too much product exists on one page.
- The right rail of channels is visually heavy.
- Many cards have similar weight, so the best recommendation does not dominate enough.

Recommended changes:

- Split into tabs.
- Put the top recommendation in a larger editorial panel.
- Reduce channel cards to a compact table or collapsible list.

### Social Settings

Strengths:

- Clear account connection purpose.
- Connector readiness is useful.

Issues:

- Long OAuth links are hidden behind buttons, which is good, but the page copy is still a little technical.
- `Developer app credentials stay in environment variables` is developer-facing.

Recommended changes:

- Replace technical copy with admin-facing copy: `Your app credentials stay private on the server.`
- Show connected/not connected states before readiness details.

### Branding Settings

Strengths:

- Good fit for making clips feel church-specific.
- Caption personality previews are useful.

Issues:

- The page mixes brand defaults, raw JSON, caption presets, and preview in one flow.
- The JSON preview feels developer-facing.

Recommended changes:

- Hide JSON under `Advanced`.
- Make preview larger and more central.
- Treat caption personality as a visual picker, not a text-heavy list.

### Opportunities

Strengths:

- The page is focused and not too wordy.
- Good bridge between sermons and reusable posts.

Issues:

- `Regeneration` sounds technical.
- `Ministry Patterns` and `Knowledge Base` are related but could be clearer.

Recommended changes:

- Rename `Regeneration` to `Refresh ideas`.
- Rename navigation labels around user goals: `Ideas`, `Library`, `Patterns`.

### Health

Strengths:

- Useful operational page for recovery.
- Clear issue/recovery intent.

Issues:

- `Can Sermon Clip Prepare Videos?` is too conversational for a diagnostics page.
- Lots of `Open clip` repeated.

Recommended changes:

- Rename title to `Video preparation health`.
- Group repeated clip issues by clip and show one action per group.

### Intelligence Dashboard

Strengths:

- Good high-level ministry pattern view.
- Clear relationship to sermon archive.

Issues:

- Some headings are title case while others are sentence case across the app.
- Charts/pattern cards need stronger visual hierarchy.

Recommended changes:

- Standardize heading casing.
- Put `Recent Sermon Activity` after the teaching/content pattern summaries.

### Knowledge Base

Strengths:

- Search-based page is simple and focused.

Issues:

- The page has many input controls for a user who likely wants one search box first.
- `Reusable Sermon Results` is accurate but not very warm.

Recommended changes:

- Start with a single search input and reveal filters after search.
- Rename `Reusable Sermon Results` to `Sermon moments`.

### Legal Pages

Routes: `/privacy`, `/terms`, `/data-deletion`

Strengths:

- Clear enough for app review and policy requirements.
- Reasonable structure.

Issues:

- Legal pages inherit the dark app shell and card density, which makes them feel heavier than necessary.

Recommended changes:

- Use a simpler reading layout.
- Keep nav actions minimal.
- Increase line length control and paragraph spacing.

## Suggested Design Principles Going Forward

1. One page, one primary job.
2. One visible primary action per section.
3. Use explanations only when they change a user decision.
4. Let videos and clip previews carry more of the visual design.
5. Put system mechanics behind progressive disclosure.
6. Keep pastor-facing copy warm and plain; keep developer/system copy out of the primary UI.
7. Prefer short labels: `Fix issue`, `Review clips`, `Prepare post`, `Open studio`.

## Suggested First Fix Sprint

1. Fix `/sermons/[id]/intelligence` layout and empty state.
2. Simplify the Home hero and priority card actions.
3. Split Growth into tabs or a staged layout.
4. Rework Ready To Post around one selected clip and one next action.
5. Reduce repeated per-card actions in Pastor Review Feed.
6. Hide advanced Brand Kit JSON and technical diagnostics behind `Advanced`.

