import {
  hasLocalActionMarker,
  hasLocalSpiritualAnchor,
} from "@/server/agents/multilingualTranscriptAnalysis";

export type ClipOpeningStatus = "CLEAN" | "SOFT_CONNECTOR" | "DEPENDENT" | "MID_SENTENCE";
export type ClipEndingStatus = "CLEAN" | "DANGLING" | "INCOMPLETE_SENTENCE";
export type ClipLandingStatus =
  | "APPLICATION"
  | "DECLARATION"
  | "INVITATION"
  | "TESTIMONY_LESSON"
  | "QUOTE_PUNCHLINE"
  | "SCRIPTURE_ANSWER"
  | "NONE";
export type ClipStandaloneStatus = "CLEAR" | "REVIEW" | "INSUFFICIENT";

export type ClipCoherenceAnalysis = {
  openingStatus: ClipOpeningStatus;
  endingStatus: ClipEndingStatus;
  landingStatus: ClipLandingStatus;
  hasSpiritualAnchor: boolean;
  hasClearTakeaway: boolean;
  setupOnly: boolean;
  pointsToFutureResponse: boolean;
  standaloneStatus: ClipStandaloneStatus;
  evidence: {
    openingText: string;
    landingText: string | null;
    reasonCodes: string[];
  };
};

const SOFT_CONNECTOR_PATTERN = /^(and|so|but|because|then|now|also|therefore|or|futhi|kodwa|ngoba|ngakho|manje|kwaye|ngoko|mme|empa|hobane|kahoo|jaanong|gonne|joale)\b/iu;
const DEPENDENT_OPENING_PATTERN =
  /^(as i said|like i said|we said|we talked about|remember when|this is why|that is why|that's why|and so|so now|but now|because of that|therefore|so then)\b|^(this|that)\s+(means|is why|is how|is what|shows|reminds|teaches|reveals)\b|^(it|they|he|she)\s+(means|shows|reminds|teaches|reveals|is|was|has|will|can|must)\b|^(for|because of)\s+(this|that)\s+reason\b|^(in|from|through)\s+(this|that|these|those)\s+(place|moment|season|truth|scripture|story|valley|reason|point|word|promise|calling|assignment)\b/i;
const DANGLING_ENDING_PATTERN = /[,;:–-]$|\b(and|but|because|so that|which means|in order to|if|when|while|although|unless|until|therefore|so)\s*$/i;
const SPIRITUAL_ANCHOR_PATTERN =
  /\b(god|jesus|christ|lord|holy spirit|scripture|bible|verse|gospel|faith|grace|mercy|prayer|salvation|repent|disciple|discipleship|forgive|forgiveness|hope|obedience|purpose|calling|worship|kingdom|cross|resurrection|holy|spirit|sin|church)\b/i;
const SETUP_ONLY_PATTERN =
  /\b(i want to|we are going to|we're going to|we re going to|let me|i'm going to|i m going to|we need to understand|before we can|the question is|today i want to|we will look at|we're looking at|we re looking at)\s+(talk about|show you|show us|teach|explain|look at|understand|ask|consider|deal with|walk through|study|see|define)\b|\b(today i want to|i want to|let me)\s+show\s+you\s+why\b/i;
const FUTURE_RESPONSE_PATTERN =
  /\b(next|later|will|going to|about to)\b.{0,80}\b(explain|show|teach|look at|see|understand)\b.{0,80}\b(how|why|what)\b.{0,80}\b(respond|apply|obey|believe|pray|serve|trust)\b/i;
const APPLICATION_PATTERN =
  /\b(so today|so this week|therefore|that means|so then|the point is|here is the point|this is why|that's why|today|this week|right now|from here|in this season|choose|trust|believe|pray|respond|obey|repent|forgive|serve|surrender|receive|walk in|apply|take one|take the|start|stop running|come to jesus|give your life)\b/i;
const ACTION_APPLICATION_PATTERN =
  /\b(so today|so this week|that means|so then|today|this week|right now|from here|in this season|therefore)\b.{0,100}\b(choose|trust|believe|pray|respond|obey|repent|forgive|serve|surrender|receive|walk|apply|take|start|stop|come)\b|\b(choose|trust|believe|pray|respond|obey|repent|forgive|serve|surrender|receive|walk in|apply|take one|take the|start|stop running|come to jesus|give your life)\b/i;
const DIRECT_PASTORAL_CALL_PATTERN =
  /\b(you|we|the church|believers)\s+(need to|must|should|can|will|are called to|have to|get to)\s+(choose|trust|believe|pray|respond|obey|repent|forgive|serve|surrender|receive|walk|apply|come|remember|stir|use)\b/i;
const INVITATION_PATTERN =
  /\b(altar|salvation|give your life|come to jesus|receive jesus|respond to god|pray this prayer|surrender today|repent and believe)\b/i;
const TESTIMONY_PATTERN =
  /\b(testimony|i remember|i have seen|god has done|god brought|god healed|god restored|god provided|when i|one day|years ago)\b/i;
const QUOTE_PATTERN =
  /\b(remember this|hear me|never forget|the point is|here is the point|i want you to know)\b/i;
const SCRIPTURE_ANSWER_PATTERN =
  /\b(scripture|bible|verse|john|romans|psalm|isaiah|matthew|mark|luke|acts|corinthians|genesis|revelation)\b.{0,140}\b(shows|answers|reminds|reveals|means|therefore|that means)\b/i;
const DECLARATION_PATTERN =
  /\b(god|jesus|christ|lord|holy spirit|grace|mercy)\b.{0,120}\b(gives|calls|restores|forgives|saves|changes|strengthens|keeps|leads|meets|carries|uses|heals|helps|placed|finishes|is faithful|has not forgotten)\b.{0,120}\b(you|your|we|us|our|the church|believers|somebody|family|neighbor|life|heart|faith)\b/i;
const GIFT_CALLING_PATTERN =
  /\b(gift|gifts|calling|purpose|assignment|anointing|mantle|what is in your hand|what god placed|what god has placed)\b/i;
const GIFT_SOURCE_PATTERN =
  /\b(god|jesus|christ|lord|holy spirit|grace|spirit)\b.{0,100}\b(placed|put|given|gave|entrusted|called|anointed|assigned|stirred|deposited)\b|\b(placed|put|given|gave|entrusted|called|anointed|assigned|stirred|deposited)\b.{0,100}\b(god|jesus|christ|lord|holy spirit|grace|spirit)\b/i;
const GIFT_RESPONSE_PATTERN =
  /\b(stir up|fan into flame|use it|use what|serve with|step into|walk in|do not bury|don't bury|don t bury|stop hiding|bring it out|put it to work|be faithful with|steward|activate|release|serve somebody|serve someone)\b|\b(gift|gifts|calling|purpose|assignment|anointing|what is in your hand)\b.{0,120}\b(serve|use|stir|step|walk|obey|faithful|courage|boldness|build|strengthen|encourage)\b/i;

export function normalizeCoherenceText(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{M}\p{N}'’\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function sentenceEndIndex(text: string): number {
  const match = text.match(/[.!?]["')\]]?(?:\s|$)/u);
  return match?.index === undefined ? -1 : match.index + match[0].trimEnd().length;
}

export function firstCoherenceSentence(text: string): string {
  const trimmed = text.trim();
  const endIndex = sentenceEndIndex(trimmed);
  return (endIndex === -1 ? trimmed : trimmed.slice(0, endIndex)).trim();
}

function coherenceSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function isMidSentence(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return /^(which|who|where|when|while|although|unless|until)\b/i.test(trimmed);
}

export function hasCallingGiftStewardshipPayoff(text: string): boolean {
  const normalized = normalizeCoherenceText(text);
  return (
    GIFT_CALLING_PATTERN.test(normalized) &&
    /\b(you|your|we|us|our|church|believers|body of christ|somebody)\b/i.test(normalized) &&
    GIFT_SOURCE_PATTERN.test(normalized) &&
    GIFT_RESPONSE_PATTERN.test(normalized)
  );
}

function classifyOpening(openingText: string): ClipOpeningStatus {
  if (isMidSentence(openingText)) return "MID_SENTENCE";
  if (DEPENDENT_OPENING_PATTERN.test(openingText.trim())) return "DEPENDENT";
  if (SOFT_CONNECTOR_PATTERN.test(openingText.trim())) return "SOFT_CONNECTOR";
  return "CLEAN";
}

function classifyEnding(text: string): ClipEndingStatus {
  const trimmed = text.trim();
  if (!trimmed || DANGLING_ENDING_PATTERN.test(trimmed)) return "DANGLING";
  if (!/[.!?]["')\]]*$/u.test(trimmed)) {
    const wordCount = (trimmed.match(/[A-Za-z0-9']+/g) ?? []).length;
    const hasSemanticLanding =
      classifyLanding(trimmed).status !== "NONE" ||
      DIRECT_PASTORAL_CALL_PATTERN.test(trimmed) ||
      hasCallingGiftStewardshipPayoff(trimmed);
    const hasCompleteSpiritualClause =
      wordCount >= 8 &&
      SPIRITUAL_ANCHOR_PATTERN.test(trimmed) &&
      !SETUP_ONLY_PATTERN.test(trimmed) &&
      !FUTURE_RESPONSE_PATTERN.test(trimmed);

    return hasSemanticLanding || hasCompleteSpiritualClause ? "CLEAN" : "INCOMPLETE_SENTENCE";
  }
  return "CLEAN";
}

function classifyLanding(text: string): { status: ClipLandingStatus; landingText: string | null; reasonCodes: string[] } {
  const sentences = coherenceSentences(text);
  const findSentence = (pattern: RegExp) => sentences.find((sentence) => pattern.test(sentence)) ?? null;
  const findLandingSentence = (pattern: RegExp) =>
    sentences.find((sentence) => pattern.test(sentence) && !SETUP_ONLY_PATTERN.test(sentence) && !FUTURE_RESPONSE_PATTERN.test(sentence)) ?? null;

  const invitation = findSentence(INVITATION_PATTERN);
  if (invitation) return { status: "INVITATION", landingText: invitation, reasonCodes: ["LANDING_INVITATION"] };

  const testimony = findSentence(TESTIMONY_PATTERN);
  if (testimony && (findSentence(APPLICATION_PATTERN) || findSentence(DECLARATION_PATTERN))) {
    return { status: "TESTIMONY_LESSON", landingText: findSentence(APPLICATION_PATTERN) ?? testimony, reasonCodes: ["LANDING_TESTIMONY_LESSON"] };
  }

  const gift = hasCallingGiftStewardshipPayoff(text);
  if (gift) {
    const landingText = findSentence(GIFT_RESPONSE_PATTERN) ?? sentences.at(-1) ?? text.trim();
    return { status: "APPLICATION", landingText, reasonCodes: ["LANDING_APPLICATION", "CALLING_GIFT_STEWARDSHIP_PAYOFF"] };
  }

  const application = findLandingSentence(ACTION_APPLICATION_PATTERN) ?? findLandingSentence(DIRECT_PASTORAL_CALL_PATTERN);
  if (application) return { status: "APPLICATION", landingText: application, reasonCodes: ["LANDING_APPLICATION"] };

  const scripture = findSentence(SCRIPTURE_ANSWER_PATTERN);
  if (scripture) return { status: "SCRIPTURE_ANSWER", landingText: scripture, reasonCodes: ["LANDING_SCRIPTURE_ANSWER"] };

  const quote = findSentence(QUOTE_PATTERN);
  if (quote && /[.!?]["')\]]*$/u.test(text.trim())) {
    return { status: "QUOTE_PUNCHLINE", landingText: quote, reasonCodes: ["LANDING_QUOTE_PUNCHLINE"] };
  }

  const declaration = findSentence(DECLARATION_PATTERN);
  if (declaration) return { status: "DECLARATION", landingText: declaration, reasonCodes: ["LANDING_DECLARATION"] };

  if (hasLocalSpiritualAnchor(text) && hasLocalActionMarker(text)) {
    return {
      status: "APPLICATION",
      landingText: sentences.at(-1) ?? text.trim(),
      reasonCodes: ["LANDING_LOCAL_LANGUAGE_ACTION", "LOCAL_LANGUAGE_REVIEW_REQUIRED"],
    };
  }

  return { status: "NONE", landingText: null, reasonCodes: ["NO_LANDING"] };
}

function detectClearTakeaway(text: string, landingStatus: ClipLandingStatus): boolean {
  return (
    landingStatus !== "NONE" ||
    DIRECT_PASTORAL_CALL_PATTERN.test(text) ||
    hasCallingGiftStewardshipPayoff(text)
  );
}

export function analyzeClipCoherence(text: string): ClipCoherenceAnalysis {
  const trimmed = text.trim();
  const openingText = firstCoherenceSentence(trimmed);
  const openingStatus = classifyOpening(openingText);
  const endingStatus = classifyEnding(trimmed);
  const landing = classifyLanding(trimmed);
  const setupOnly = SETUP_ONLY_PATTERN.test(trimmed);
  const pointsToFutureResponse = FUTURE_RESPONSE_PATTERN.test(trimmed);
  const hasSpiritualAnchor = SPIRITUAL_ANCHOR_PATTERN.test(trimmed) || hasLocalSpiritualAnchor(trimmed);
  const hasClearTakeaway = detectClearTakeaway(trimmed, landing.status);
  const reasonCodes = new Set<string>(landing.reasonCodes);

  if (openingStatus !== "CLEAN") reasonCodes.add(`OPENING_${openingStatus}`);
  if (endingStatus !== "CLEAN") reasonCodes.add(`ENDING_${endingStatus}`);
  if (hasSpiritualAnchor) reasonCodes.add("SPIRITUAL_ANCHOR");
  if (hasClearTakeaway) reasonCodes.add("CLEAR_TAKEAWAY");
  if (setupOnly) reasonCodes.add("SETUP_ONLY");
  if (pointsToFutureResponse) reasonCodes.add("POINTS_TO_FUTURE_RESPONSE");

  const standaloneStatus: ClipStandaloneStatus =
    !hasSpiritualAnchor || setupOnly || pointsToFutureResponse || endingStatus !== "CLEAN" || openingStatus === "MID_SENTENCE" || openingStatus === "DEPENDENT"
      ? "INSUFFICIENT"
      : openingStatus === "SOFT_CONNECTOR" || landing.status === "NONE" || !hasClearTakeaway
        ? "REVIEW"
        : "CLEAR";

  return {
    openingStatus,
    endingStatus,
    landingStatus: landing.status,
    hasSpiritualAnchor,
    hasClearTakeaway,
    setupOnly,
    pointsToFutureResponse,
    standaloneStatus,
    evidence: {
      openingText,
      landingText: landing.landingText,
      reasonCodes: [...reasonCodes],
    },
  };
}

export function hasClipLanding(text: string): boolean {
  return analyzeClipCoherence(text).landingStatus !== "NONE";
}

export function hasClipPayoff(text: string): boolean {
  const analysis = analyzeClipCoherence(text);
  return analysis.hasClearTakeaway && analysis.landingStatus !== "NONE";
}
