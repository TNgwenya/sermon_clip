import type { ClipWindow } from "@/server/agents/clipIntelligenceAgent";
import { SMART_CLIP_CATEGORIES, type MinistryMomentRecord } from "@/server/ai/ministryMomentSchema";

type SermonIntelligenceContext = {
  title?: string | null;
  summary?: string | null;
  centralTheme?: string | null;
  shortOverview?: string | null;
  keyTakeaways?: string[] | null;
  scriptures?: Array<{ reference: string; usageType: string; isPrimary?: boolean }>;
  topics?: Array<{ topic: string }>;
  structureSections?: Array<{ sectionType: string; title?: string | null; description?: string | null }>;
};

type SermonPromptContext = {
  title: string;
  speakerName: string;
  churchName: string;
  language: string;
};

const jsonShape = `{
  "clips": [
    {
      "windowId": "<one of the supplied Window IDs>",
      "startSegmentIndex": 0,
      "endSegmentIndex": 3,
      "hookSegmentIndex": 0,
      "landingSegmentIndex": 3,
      "title": "",
      "hook": "",
      "caption": "",
      "suggestedHook": "",
      "suggestedCaption": "",
      "hashtags": ["#Faith"],
      "score": 8,
      "reasonSelected": "",
      "landingSentence": "Exact spoken sentence or phrase that makes this clip land.",
      "clipType": "teaching",
      "smartClipCategory": "Best Faith Clip",
      "intendedAudience": "People who need encouragement",
      "ministryValue": "Clear ministry outcome",
      "socialValue": "Strong short-form value",
      "ministryMomentType": "FAITH_DECLARATION",
      "ministryMomentTitle": "Faith declaration",
      "riskLevel": "LOW",
      "riskReasons": [],
      "contextWarning": false,
      "arcType": "SCRIPTURE_EXPLANATION_APPLICATION",
      "arcSummary": "Setup, scripture truth, and application.",
      "setupStartTime": null,
      "mainPointTime": null,
      "payoffTime": null,
      "applicationTime": null,
      "whyThisClipFeelsComplete": "The thought has setup, a clear point, and a landing.",
      "whatContextMightBeMissing": null
    }
  ]
}`;

const smartClipCategoryInstructions = SMART_CLIP_CATEGORIES.map((category) => `- ${category}`).join("\n");

export function buildClipSelectionSystemPrompt(): string {
  return [
    "You are selecting ministry-aware sermon clips for church social media.",
    "Do not optimize only for viral content.",
    "Build a generous pastor review shortlist, not only a final post-ready list.",
    "Pastors want to see many good options before choosing what to publish. Return every genuinely useful clip candidate in the provided windows, up to the requested count.",
    "A normal full sermon should usually produce 12-20 pastor-review-worthy options across worship, prayer, teaching, application, encouragement, scripture, testimony, quote-worthy moments, and calls to action.",
    "Do not hide a useful clip just because it needs trimming, captions, or pastor review. Include it when the core sermon moment is strong and label risk/context honestly.",
    "Optimize for pastoral tone, scripture clarity, ministry value, clear standalone teaching, spiritual encouragement, and contextual safety.",
    "Prefer clips that serve a ministry outcome like prayer, encouragement, discipleship, leadership, testimony, salvation, evangelism, family, or Sunday invitation.",
    "When transcript windows include a Ministry payoff quality score, treat it as a strong clue for where the best sermon clips are, but never select a clip unless the spoken transcript evidence supports it.",
    "Every selected clip must have a real sermon takeaway: a spiritual anchor such as God, Jesus, Scripture, faith, grace, prayer, salvation, discipleship, obedience, purpose, or worship, plus a clear truth, application, invitation, testimony lesson, or pastoral encouragement that lands.",
    "Never select a setup-only introduction where the pastor merely says what they are about to explain, teach, show, or ask. The selected excerpt must include the actual point landing, not only the promise of a point.",
    "Before returning each clip, identify the exact spoken landing sentence inside transcriptText. The landing must be an application, invitation, pastoral declaration, testimony lesson, scripture answer, or memorable quote/punchline.",
    "Do not treat generic theology, background exposition, or a future promise like 'we will see how believers should respond' as a landing. The clip must contain the response, payoff, invitation, declaration, or lesson itself.",
    "A statement like 'God is faithful' only counts as a landing when the same spoken sentence carries personal pastoral payoff or ministry application for the listener.",
    "If you cannot point to that landing sentence in the excerpt, do not return the clip.",
    "Put that exact spoken evidence in landingSentence. It must be copied or very closely quoted from transcriptText, not invented or summarized.",
    "The reasonSelected field must quote or closely paraphrase distinctive words from that spoken landing sentence. Do not use generic reasons like 'strong teaching' or 'clear application' without naming the actual words that land.",
    "Return structured JSON only.",
    "Do not include markdown.",
    "Do not include commentary outside JSON.",
    "Use duration targets by clip type: quote or punchline 20-40s, teaching insight 45-90s, scripture explanation 60-120s, story or testimony 75-150s, emotional ministry moment 60-120s, altar call/invitation 30-75s, application 35-75s.",
    "Keep most clips under 90 seconds. Use up to 150 seconds only for story, testimony, scripture explanation, and emotional ministry moments.",
    "Avoid clips that start or end mid-sentence.",
    "Avoid clip starts like 'and', 'but', 'so', or 'because' unless enough context is included before that phrase.",
    "End the clip after the key point lands, not before.",
    "Avoid greetings, announcements, admin, warm-up banter, setup-only explanations, unresolved points, inside jokes, or anything that needs a long prior context to make sense.",
    "Avoid generic motivational, productivity, confidence, or leadership clips unless the excerpt itself clearly carries a sermon truth and ministry takeaway.",
    "Do not inflate scores. Use 7.0-7.9 for good pastor-review options, 8.0+ for strong publish candidates, and 8.5+ only for standout clips with a strong hook, faithful sermon substance, and a clear landing sentence.",
    "A clip that only tees up a future point should score below 7.0 or be omitted, but a complete review-worthy teaching, prayer, quote, worship, or application moment can be returned even if it is not perfect yet.",
    "Prefer diversity over a single exceptional ministry-climax clip. When several windows contain different useful moments, include several options so the pastor can choose.",
    "Avoid private names, giving or money appeals, counseling details, church discipline, internal admin, and controversial claims without context.",
    "Avoid clickbait or manipulative language.",
    "Use only these clipType values: inspirational, teaching, evangelistic, testimony, leadership, funny, prophetic, pastoral.",
    "Use only these smartClipCategory values:",
    smartClipCategoryInstructions,
    "Use only these riskLevel values: LOW, MEDIUM, HIGH.",
    "Every clip must explain why it was selected, what ministry category it belongs to, who it is useful for, and what spiritual or emotional value it has.",
    "Every clip must include sermon mini-arc metadata: arcType, arcSummary, setupStartTime, mainPointTime, payoffTime, applicationTime, whyThisClipFeelsComplete, and whatContextMightBeMissing.",
    "Return windowId, startSegmentIndex, and endSegmentIndex for every clip. landingSegmentIndex is required whenever the landing is identifiable in one transcript line. hookSegmentIndex is optional.",
    "Do not invent startTimeSeconds, endTimeSeconds, durationSeconds, or transcriptText. The application derives those from the selected transcript segment indexes.",
    "Allowed arcType values: PROBLEM_TRUTH_APPLICATION, QUESTION_SCRIPTURE_ANSWER, STORY_LESSON_PUNCHLINE, PAIN_HOPE_DECLARATION, CORRECTION_EXPLANATION_CALL, SCRIPTURE_EXPLANATION_APPLICATION, QUOTE_WITH_CONTEXT, TESTIMONY_TO_APPLICATION, ALTAR_CALL_INVITATION.",
    "Exact JSON shape required:",
    jsonShape,
  ].join("\n");
}

function buildIndexedExample(window: ClipWindow): string {
  const segmentCount = window.segments?.length ?? window.segmentLines.length;
  const endSegmentIndex = Math.min(segmentCount - 1, Math.max(0, segmentCount - 1));
  return JSON.stringify({
    clips: [
      {
        windowId: window.windowId,
        startSegmentIndex: 0,
        endSegmentIndex,
        hookSegmentIndex: 0,
        landingSegmentIndex: endSegmentIndex,
        title: "Use a concise title based on the selected transcript",
        hook: "Use the opening phrase from the selected segment range",
        caption: "Use a post caption grounded in the selected segment range",
        suggestedHook: "Optional alternate hook",
        suggestedCaption: "Optional alternate caption",
        hashtags: ["#Faith"],
        score: 8,
        reasonSelected: "Quote or closely paraphrase the exact landing phrase from the selected transcript lines.",
        landingSentence: "Exact spoken sentence or phrase from the selected segment range.",
        clipType: "teaching",
        smartClipCategory: "Best Faith Clip",
        intendedAudience: "People who need encouragement",
        ministryValue: "Clear ministry outcome",
        socialValue: "Strong short-form value",
        ministryMomentType: "FAITH_DECLARATION",
        ministryMomentTitle: "Faith declaration",
        riskLevel: "LOW",
        riskReasons: [],
        contextWarning: false,
        arcType: "SCRIPTURE_EXPLANATION_APPLICATION",
        arcSummary: "Setup, scripture truth, and application.",
        setupStartTime: null,
        mainPointTime: null,
        payoffTime: null,
        applicationTime: null,
        whyThisClipFeelsComplete: "The selected segment range contains setup, truth, and landing.",
        whatContextMightBeMissing: null,
      },
    ],
  }, null, 2);
}

export function buildClipSelectionUserPrompt(
  sermon: SermonPromptContext,
  windows: ClipWindow[],
  requestedCount: number,
  context?: {
    intelligence?: SermonIntelligenceContext;
    ministryMoments?: MinistryMomentRecord[];
  },
): string {
  const windowText = windows
    .map((window, index) => {
      return [
        `Window ${index + 1}`,
        `Window ID: ${window.windowId}`,
        `Start: ${window.startTimeSeconds}`,
        `End: ${window.endTimeSeconds}`,
        `Duration: ${window.durationSeconds}`,
        `Window quality: ${window.windowQualityScore}/10`,
        `Opening hook quality: ${window.openingHookScore ?? "not scored"}/10`,
        `Ministry payoff quality: ${window.ministryPayoffScore ?? "not scored"}/10`,
        `Words: ${window.wordCount}`,
        `Meaningful segments: ${window.meaningfulSegmentCount}`,
        "Transcript segments:",
        ...window.segmentLines,
      ].join("\n");
    })
    .join("\n\n");
  const validWindowIds = windows.map((window) => window.windowId).join(", ");
  const exampleWindow = windows[0];

  return [
    `Sermon Title: ${sermon.title}`,
    `Speaker Name: ${sermon.speakerName}`,
    `Church Name: ${sermon.churchName}`,
    `Language: ${sermon.language}`,
    `Select up to ${requestedCount} strong or pastor-review-worthy clip candidates from these windows.`,
    "Treat the requested count as the target when the windows contain enough useful moments. Return fewer only when the candidates are genuinely weak or unsafe.",
    "Prefer strong quotes, clear teaching, scripture explanations, prayer moments, salvation invitations, testimony moments, pastoral encouragement, and calls to action.",
    "Only choose a moment when it has a strong opening, can stand alone without the listener watching the full sermon, and lands with a clear takeaway.",
    "Do not choose a window just because it introduces an important topic. Choose it only when the excerpt includes the actual answer, application, invitation, or memorable payoff.",
    "Reject clips whose final sentence only points to a later answer, later application, or later response.",
    "For every returned clip, reasonSelected must name the exact landing sentence or phrase that makes the clip complete.",
    "Set landingSentence to the exact spoken sentence or phrase that makes the clip worth reviewing. It must appear in the selected transcriptText.",
    "Make reasonSelected evidence-based: include distinctive words spoken in the selected range, especially the payoff, invitation, or application line.",
    "Skip weak candidates, but include good review-worthy options that need trimming, captions, or pastor judgment.",
    "Set contextWarning to true when a clip may be misunderstood without surrounding context.",
    `Valid window IDs for this batch: ${validWindowIds}`,
    "Use zero-based segment indexes exactly as shown in each transcript segment line.",
    "Application-derived fields: startTimeSeconds, endTimeSeconds, durationSeconds, and transcriptText. Do not include or rely on those fields in your response.",
    exampleWindow ? ["Example using a real supplied window ID:", buildIndexedExample(exampleWindow)].join("\n") : "",
    context?.intelligence
      ? [
          "Sermon intelligence context:",
          `Generated title: ${context.intelligence.title ?? sermon.title}`,
          `Summary: ${context.intelligence.summary ?? ""}`,
          `Central theme: ${context.intelligence.centralTheme ?? ""}`,
          `Short overview: ${context.intelligence.shortOverview ?? ""}`,
          `Key takeaways: ${(context.intelligence.keyTakeaways ?? []).join(" | ")}`,
          `Scriptures: ${(context.intelligence.scriptures ?? []).map((scripture) => scripture.reference).join(", ")}`,
          `Topics: ${(context.intelligence.topics ?? []).map((topic) => topic.topic).join(", ")}`,
          `Structure sections: ${(context.intelligence.structureSections ?? []).map((section) => section.sectionType).join(", ")}`,
        ].join("\n")
      : "",
    context?.ministryMoments && context.ministryMoments.length > 0
      ? [
          "Detected ministry moments:",
          ...context.ministryMoments.map((moment, index) => {
            return [
              `Moment ${index + 1}`,
              `Type: ${moment.momentType}`,
              `Title: ${moment.title}`,
              `Description: ${moment.description}`,
              `Start: ${moment.startTimeSeconds ?? "n/a"}`,
              `End: ${moment.endTimeSeconds ?? "n/a"}`,
              `Audience: ${moment.suggestedAudience}`,
              `Usage: ${moment.suggestedUsage}`,
              `Why detected: ${moment.whyDetected}`,
              `Excerpt: ${moment.transcriptExcerpt}`,
            ].join("\n");
          }),
        ].join("\n\n")
      : "",
    "Use supplied windowId plus startSegmentIndex/endSegmentIndex/hookSegmentIndex/landingSegmentIndex from the supplied window. The indexes are zero-based within each Window transcript list.",
    "The selected indexes must refer to the exact supplied window and transcript lines; do not reference another batch.",
    "Choose start and end segment indexes on natural sentence or complete-thought boundaries.",
    "Transcript windows with timestamps:",
    windowText,
  ].join("\n\n");
}

export function buildClipRepairPrompt(rawResponse: string, validationError: string, windows: ClipWindow[] = []): string {
  const windowDetails = windows.map((window) => [
    `Window ID: ${window.windowId}`,
    `Valid segment indexes: 0-${Math.max(0, (window.segments?.length ?? window.segmentLines.length) - 1)}`,
    "Transcript segments:",
    ...window.segmentLines,
  ].join("\n")).join("\n\n");

  return [
    "The previous response was invalid JSON or failed schema validation.",
    "Fix the response so it strictly matches the schema and constraints.",
    "Validation failure details:",
    validationError,
    windows.length > 0 ? "Valid batch windows and segment indexes:" : "",
    windowDetails,
    "Allowed clipType values: inspirational, teaching, evangelistic, testimony, leadership, funny, prophetic, pastoral.",
    `Allowed smartClipCategory values: ${SMART_CLIP_CATEGORIES.join(", ")}.`,
    "Allowed riskLevel values: LOW, MEDIUM, HIGH.",
    "Allowed arcType values: PROBLEM_TRUTH_APPLICATION, QUESTION_SCRIPTURE_ANSWER, STORY_LESSON_PUNCHLINE, PAIN_HOPE_DECLARATION, CORRECTION_EXPLANATION_CALL, SCRIPTURE_EXPLANATION_APPLICATION, QUOTE_WITH_CONTEXT, TESTIMONY_TO_APPLICATION, ALTAR_CALL_INVITATION.",
    "Use only valid window IDs and segment indexes from this batch. Do not invent timestamps or transcript text.",
    "Repair it and return JSON only with this exact shape:",
    jsonShape,
    "Previous response:",
    rawResponse,
  ].join("\n\n");
}
