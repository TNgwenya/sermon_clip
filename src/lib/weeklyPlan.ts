import type { ContentPublishingPlatform } from "@/lib/contentPublishing";

export const WEEKLY_PLAN_OBJECTIVES = [
  "REACH",
  "DISCIPLESHIP",
  "PRAYER",
  "INVITATION",
  "ENGAGEMENT",
] as const;

export type WeeklyPlanObjective = (typeof WEEKLY_PLAN_OBJECTIVES)[number];
export type WeeklyPlanSourceKind = "CLIP" | "CONTENT_ASSET";

export type WeeklyPlanCandidate = {
  id: string;
  sourceKind: WeeklyPlanSourceKind;
  sermonId: string;
  title: string;
  caption: string;
  contentType: string;
  pointKey: string;
  relatedScripture?: string | null;
  suggestedPlatform?: ContentPublishingPlatform | null;
  qualityScore?: number | null;
  alreadyScheduled: Array<{
    platform: ContentPublishingPlatform;
    scheduledFor: string | null;
    status: string;
  }>;
};

export type WeeklyPlanItem = {
  sourceId: string;
  sourceKind: WeeklyPlanSourceKind;
  sermonId: string;
  title: string;
  caption: string;
  contentType: string;
  pointKey: string;
  platform: ContentPublishingPlatform;
  scheduledFor: string;
  duplicateWarnings: string[];
};

export type WeeklyPlanBuildInput = {
  candidates: WeeklyPlanCandidate[];
  sermonId: string;
  weekStart: string | Date;
  platforms: ContentPublishingPlatform[];
  frequency: number;
  objective: WeeklyPlanObjective;
  timezone?: string;
};

export function resolveWeeklyPlanPlatform(input: {
  planned: ContentPublishingPlatform;
  override?: ContentPublishingPlatform | null;
  selectedPlatforms: ContentPublishingPlatform[];
}): ContentPublishingPlatform {
  return input.override && input.selectedPlatforms.includes(input.override)
    ? input.override
    : input.planned;
}

export function findExactScheduleDuplicateWarning(input: {
  candidate: Pick<WeeklyPlanCandidate, "alreadyScheduled">;
  platform: ContentPublishingPlatform;
  scheduledFor: string | Date;
}): string | null {
  const scheduledFor = input.scheduledFor instanceof Date
    ? input.scheduledFor
    : new Date(input.scheduledFor);
  if (Number.isNaN(scheduledFor.getTime())) return null;
  const windowMs = 14 * 24 * 60 * 60_000;
  const duplicate = input.candidate.alreadyScheduled.some((schedule) => {
    if (schedule.platform !== input.platform || !schedule.scheduledFor) return false;
    const existingTime = new Date(schedule.scheduledFor).getTime();
    return Number.isFinite(existingTime)
      && Math.abs(existingTime - scheduledFor.getTime()) <= windowMs
      && !["FAILED", "SKIPPED"].includes(schedule.status);
  });
  return duplicate
    ? "This exact item is already scheduled on this platform within fourteen days."
    : null;
}

const OBJECTIVE_TERMS: Record<WeeklyPlanObjective, string[]> = {
  REACH: ["clip", "quote", "recap", "story", "testimony", "hook"],
  DISCIPLESHIP: ["devotional", "guide", "teaching", "scripture", "discussion", "application"],
  PRAYER: ["prayer", "healing", "encouragement", "faith", "hope"],
  INVITATION: ["invitation", "event", "service", "gospel", "salvation", "altar"],
  ENGAGEMENT: ["discussion", "story", "question", "poll", "carousel", "testimony"],
};

const STOP_WORDS = new Set([
  "about", "after", "again", "from", "into", "only", "sermon", "that", "their",
  "there", "these", "this", "through", "with", "your", "you", "the", "and", "for",
]);

function cleanText(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function deriveSermonPointKey(input: {
  title: string;
  contentType?: string | null;
  relatedScripture?: string | null;
  explicitPointKey?: string | null;
}): string {
  const explicit = cleanText(input.explicitPointKey ?? "");
  if (explicit) return explicit;

  const scripture = cleanText(input.relatedScripture ?? "");
  if (scripture) return `scripture:${scripture}`;

  const words = cleanText(`${input.contentType ?? ""} ${input.title}`)
    .split(" ")
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word))
    .slice(0, 5);
  return words.join(":") || "general-sermon-point";
}

export function normalizeWeeklyPlanFrequency(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return 5;
  return Math.max(1, Math.min(7, Math.round(number)));
}

type LocalCalendarDateTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second?: number;
};

function parseCalendarDate(value: string | Date): { year: number; month: number; day: number } | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return {
      year: value.getUTCFullYear(),
      month: value.getUTCMonth() + 1,
      day: value.getUTCDate(),
    };
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    ? { year, month, day }
    : null;
}

export function isValidIanaTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date(0));
    return Boolean(timezone.trim());
  } catch {
    return false;
  }
}

function partsInTimeZone(instant: Date, timezone: string): LocalCalendarDateTime | null {
  const values = new Map(new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant).map((part) => [part.type, part.value]));
  const result = {
    year: Number(values.get("year")),
    month: Number(values.get("month")),
    day: Number(values.get("day")),
    hour: Number(values.get("hour")),
    minute: Number(values.get("minute")),
    second: Number(values.get("second")),
  };
  return Object.values(result).every(Number.isFinite) ? result : null;
}

export function localDateTimeToUtcInstant(
  local: LocalCalendarDateTime,
  timezone: string,
): Date | null {
  if (!isValidIanaTimeZone(timezone)) return null;
  const desiredUtcShape = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second ?? 0,
  );
  let instantMs = desiredUtcShape;

  // Resolve the zone offset at the requested local wall-clock time. Iteration
  // handles offset changes around daylight-saving boundaries without relying
  // on the machine's own timezone.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const formatted = partsInTimeZone(new Date(instantMs), timezone);
    if (!formatted) return null;
    const formattedUtcShape = Date.UTC(
      formatted.year,
      formatted.month - 1,
      formatted.day,
      formatted.hour,
      formatted.minute,
      formatted.second ?? 0,
    );
    const adjustment = desiredUtcShape - formattedUtcShape;
    if (adjustment === 0) return new Date(instantMs);
    instantMs += adjustment;
  }

  const resolved = new Date(instantMs);
  const formatted = partsInTimeZone(resolved, timezone);
  return formatted
    && formatted.year === local.year
    && formatted.month === local.month
    && formatted.day === local.day
    && formatted.hour === local.hour
    && formatted.minute === local.minute
    ? resolved
    : null;
}

export function startOfLocalWeek(value: string | Date): Date | null {
  const calendarDate = parseCalendarDate(value);
  if (!calendarDate) return null;
  const date = new Date(Date.UTC(calendarDate.year, calendarDate.month - 1, calendarDate.day));
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - mondayOffset);
  return date;
}

export function nextMondayDateInput(now: Date): string {
  const result = new Date(now);
  result.setHours(0, 0, 0, 0);
  const daysUntilNextMonday = ((8 - result.getDay()) % 7) || 7;
  result.setDate(result.getDate() + daysUntilNextMonday);
  const year = result.getFullYear();
  const month = String(result.getMonth() + 1).padStart(2, "0");
  const day = String(result.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function evenlySpacedDayIndexes(frequency: number): number[] {
  if (frequency === 1) return [2];
  if (frequency >= 7) return Array.from({ length: frequency }, (_, index) => index % 7);
  return Array.from({ length: frequency }, (_, index) => (
    Math.round((index * 6) / Math.max(1, frequency - 1))
  ));
}

function objectiveAffinity(candidate: WeeklyPlanCandidate, objective: WeeklyPlanObjective): number {
  const haystack = cleanText(`${candidate.contentType} ${candidate.title} ${candidate.pointKey}`);
  return OBJECTIVE_TERMS[objective].reduce(
    (score, term) => score + (haystack.includes(term) ? 12 : 0),
    0,
  );
}

function candidateScore(candidate: WeeklyPlanCandidate, objective: WeeklyPlanObjective): number {
  const rawQuality = candidate.qualityScore ?? (candidate.sourceKind === "CONTENT_ASSET" ? 60 : 50);
  const quality = rawQuality >= 0 && rawQuality <= 10 ? rawQuality * 10 : rawQuality;
  const readyBonus = candidate.alreadyScheduled.length === 0 ? 10 : -10;
  return quality + objectiveAffinity(candidate, objective) + readyBonus;
}

function mixCandidateKinds(
  candidates: WeeklyPlanCandidate[],
  objective: WeeklyPlanObjective,
): WeeklyPlanCandidate[] {
  const clips = candidates
    .filter((candidate) => candidate.sourceKind === "CLIP")
    .sort((left, right) => candidateScore(right, objective) - candidateScore(left, objective));
  const assets = candidates
    .filter((candidate) => candidate.sourceKind === "CONTENT_ASSET")
    .sort((left, right) => candidateScore(right, objective) - candidateScore(left, objective));
  const mixed: WeeklyPlanCandidate[] = [];
  let preferAsset = objective !== "REACH";

  while (clips.length > 0 || assets.length > 0) {
    const preferred = preferAsset ? assets : clips;
    const fallback = preferAsset ? clips : assets;
    const next = preferred.shift() ?? fallback.shift();
    if (next) mixed.push(next);
    preferAsset = !preferAsset;
  }
  return mixed;
}

function duplicateWarningsForCandidate(input: {
  candidate: WeeklyPlanCandidate;
  platform: ContentPublishingPlatform;
  scheduledFor: Date;
  usedPointKeys: Map<string, number>;
}): string[] {
  const warnings: string[] = [];
  const repeatedPointCount = input.usedPointKeys.get(input.candidate.pointKey) ?? 0;
  if (repeatedPointCount > 0) {
    warnings.push("This week already includes another post built from the same sermon point.");
  }

  const exactWarning = findExactScheduleDuplicateWarning({
    candidate: input.candidate,
    platform: input.platform,
    scheduledFor: input.scheduledFor,
  });
  if (exactWarning) warnings.push(exactWarning);
  return warnings;
}

export function buildWeeklyPlan(input: WeeklyPlanBuildInput): WeeklyPlanItem[] {
  const weekStart = startOfLocalWeek(input.weekStart);
  const timezone = input.timezone?.trim() || "Africa/Johannesburg";
  const platforms = Array.from(new Set(input.platforms));
  const frequency = normalizeWeeklyPlanFrequency(input.frequency);
  if (!weekStart || !isValidIanaTimeZone(timezone) || platforms.length === 0 || !input.sermonId.trim()) return [];

  const candidates = mixCandidateKinds(
    input.candidates.filter((candidate) => candidate.sermonId === input.sermonId),
    input.objective,
  );
  const dayIndexes = evenlySpacedDayIndexes(frequency);
  const usedPointKeys = new Map<string, number>();
  const result: WeeklyPlanItem[] = [];

  for (let index = 0; index < Math.min(frequency, candidates.length); index += 1) {
    const candidate = candidates[index];
    const platform = candidate.suggestedPlatform && platforms.includes(candidate.suggestedPlatform)
      ? candidate.suggestedPlatform
      : platforms[index % platforms.length];
    const scheduledDate = new Date(weekStart);
    scheduledDate.setUTCDate(scheduledDate.getUTCDate() + dayIndexes[index]);
    const scheduledFor = localDateTimeToUtcInstant({
      year: scheduledDate.getUTCFullYear(),
      month: scheduledDate.getUTCMonth() + 1,
      day: scheduledDate.getUTCDate(),
      hour: index % 2 === 0 ? 18 : 12,
      minute: index % 2 === 0 ? 0 : 30,
    }, timezone);
    if (!scheduledFor) continue;
    const warnings = duplicateWarningsForCandidate({
      candidate,
      platform,
      scheduledFor,
      usedPointKeys,
    });
    result.push({
      sourceId: candidate.id,
      sourceKind: candidate.sourceKind,
      sermonId: candidate.sermonId,
      title: candidate.title,
      caption: candidate.caption,
      contentType: candidate.contentType,
      pointKey: candidate.pointKey,
      platform,
      scheduledFor: scheduledFor.toISOString(),
      duplicateWarnings: warnings,
    });
    usedPointKeys.set(candidate.pointKey, (usedPointKeys.get(candidate.pointKey) ?? 0) + 1);
  }

  return result;
}

export function findRepeatedSermonPointWarnings(items: Array<Pick<WeeklyPlanItem, "sourceId" | "pointKey" | "title">>): string[] {
  const grouped = new Map<string, Array<{ sourceId: string; title: string }>>();
  items.forEach((item) => grouped.set(item.pointKey, [
    ...(grouped.get(item.pointKey) ?? []),
    { sourceId: item.sourceId, title: item.title },
  ]));
  return [...grouped.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([, group]) => `Repeated sermon point: ${group.map((item) => item.title).join(" · ")}`);
}
