const VIEWER_LANGUAGE_PATTERN = /\b(?:you|your|you['’]re|you['’]ve|you['’]ll|yourself)\b/iu;
const QUESTION_OPENER_PATTERN = /^(?:can|could|do|does|did|have|has|how|is|are|should|what|when|where|why|will|would)\b/iu;
const CURIOSITY_PATTERN = /\b(?:back|change|cost|focus|future|happen|holding|keep|life|mind|missing|really|stuck|wrong)\b/iu;
const CLICKBAIT_PATTERN = /\b(?:jaw[- ]dropping|must watch|secret nobody|shocking|watch before|won['’]t believe)\b/iu;
const EMOJI_PATTERN = /\p{Extended_Pictographic}/u;

export const TEACHING_VIDEO_TITLE_MIN_SCORE = 80;
export const TEACHING_VIDEO_TITLE_MIN_WORDS = 5;
export const TEACHING_VIDEO_TITLE_MAX_WORDS = 14;

export type TeachingVideoTitleAssessment = {
  title: string;
  score: number;
  passes: boolean;
  wordCount: number;
  signals: string[];
  problems: string[];
};

function words(value: string): string[] {
  return value.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? [];
}

function hasExcessiveUppercase(value: string): boolean {
  const letterWords = words(value).filter((word) => /\p{L}/u.test(word));
  const uppercaseWords = letterWords.filter((word) => (
    word.length >= 3
    && word === word.toLocaleUpperCase()
    && word !== word.toLocaleLowerCase()
  ));
  return uppercaseWords.length >= 2;
}

export function assessTeachingVideoTitle(value: string): TeachingVideoTitleAssessment {
  const title = value.replace(/\s+/g, " ").trim();
  const titleWords = words(title);
  const wordCount = titleWords.length;
  const isQuestion = title.endsWith("?");
  const opensAsQuestion = QUESTION_OPENER_PATTERN.test(title);
  const viewerCentered = VIEWER_LANGUAGE_PATTERN.test(title);
  const idealLength = wordCount >= 7 && wordCount <= 11;
  const acceptableLength = (
    wordCount >= TEACHING_VIDEO_TITLE_MIN_WORDS
    && wordCount <= TEACHING_VIDEO_TITLE_MAX_WORDS
  );
  const createsCuriosity = CURIOSITY_PATTERN.test(title);
  const hasClickbait = (
    CLICKBAIT_PATTERN.test(title)
    || /[!?]{2,}/u.test(title)
    || hasExcessiveUppercase(title)
    || EMOJI_PATTERN.test(title)
  );

  let score = 0;
  const signals: string[] = [];
  const problems: string[] = [];

  if (isQuestion && opensAsQuestion) {
    score += 30;
    signals.push("DIRECT_QUESTION");
  } else {
    problems.push("NOT_A_DIRECT_QUESTION");
  }

  if (viewerCentered) {
    score += 25;
    signals.push("VIEWER_CENTERED");
  } else {
    problems.push("NOT_VIEWER_CENTERED");
  }

  if (idealLength) {
    score += 20;
    signals.push("IDEAL_LENGTH");
  } else if (acceptableLength) {
    score += 12;
    signals.push("ACCEPTABLE_LENGTH");
  } else {
    problems.push("WEAK_LENGTH");
  }

  if (createsCuriosity) {
    score += 15;
    signals.push("CURIOSITY_OR_STAKES");
  }

  if (!hasClickbait) {
    score += 10;
    signals.push("NON_CLICKBAIT");
  } else {
    score -= 30;
    problems.push("CLICKBAIT_OR_HYPE");
  }

  const boundedScore = Math.max(0, Math.min(100, score));
  return {
    title,
    score: boundedScore,
    passes: (
      boundedScore >= TEACHING_VIDEO_TITLE_MIN_SCORE
      && isQuestion
      && opensAsQuestion
      && viewerCentered
      && acceptableLength
      && !hasClickbait
    ),
    wordCount,
    signals,
    problems,
  };
}

export function selectBestTeachingVideoTitle(
  options: readonly string[],
): TeachingVideoTitleAssessment | null {
  const unique = Array.from(new Set(
    options
      .map((option) => option.replace(/\s+/g, " ").trim())
      .filter(Boolean),
  ));

  return unique
    .map(assessTeachingVideoTitle)
    .filter((assessment) => assessment.passes)
    .sort((left, right) => (
      right.score - left.score
      || Math.abs(left.wordCount - 9) - Math.abs(right.wordCount - 9)
      || unique.indexOf(left.title) - unique.indexOf(right.title)
    ))[0] ?? null;
}
