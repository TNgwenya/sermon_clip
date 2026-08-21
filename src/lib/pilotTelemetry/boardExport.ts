export type PilotChurchWeekObservation = {
  weekStart: string;
  onboardingComplete: boolean | null;
  activeThisWeek: boolean;
  sermonsStarted: number;
  suggestionsReady: number;
  firstBrandedPreviewReady: number;
  fullContentSetReady: number;
  weeklyWorkflowCompleted: boolean;
  suggestionMinutesTotal: number;
  suggestionTimingSampleCount: number;
  firstPreviewMinutesTotal: number;
  firstPreviewTimingSampleCount: number;
  supportIncidentCount: number;
  supportMinutes: number;
  criticalIncidentCount: number;
  pastoralAccuracyIncidentCount: number;
  privacySecurityIncidentCount: number;
};

export type PilotEvidenceLabel = "INSUFFICIENT_SAMPLE" | "PILOT_DIRECTIONAL";
export type PilotStopState = "CONTINUE_PILOT" | "CONTINUE_WITH_LIMITS" | "WATCH" | "PAUSE_PILOT" | "STOP_PILOT";

export type PilotWeeklyCohortAggregate = {
  weekStart: string;
  churchWeeksObserved: number;
  activeChurches: number;
  onboardingEvidenceState: "KNOWN" | "PARTIAL" | "UNKNOWN";
  onboardingObservedChurches: number;
  onboardingCompleteChurches: number;
  sermonsStarted: number;
  suggestionsReady: number;
  firstBrandedPreviewsReady: number;
  fullContentSetsReady: number;
  completedWeeklyWorkflows: number;
  suggestionReadyRate: number | null;
  firstPreviewReadyRate: number | null;
  fullContentReadyRate: number | null;
  workflowCompletionRate: number | null;
  averageSuggestionMinutes: number | null;
  suggestionTimingSamples: number;
  averageFirstPreviewMinutes: number | null;
  firstPreviewTimingSamples: number;
  supportIncidents: number;
  supportMinutes: number;
  supportMinutesPerActiveChurch: number | null;
  criticalIncidents: number;
  pastoralAccuracyIncidents: number;
  privacySecurityIncidents: number;
};

export type PilotStopCondition = {
  id: string;
  state: Exclude<PilotStopState, "CONTINUE_WITH_LIMITS">;
  triggered: boolean;
  summary: string;
};

export type PilotBoardExport = {
  schemaVersion: 1;
  generatedAt: string;
  scope: "PILOT_COHORT_AGGREGATE";
  privacy: "NO_CHURCH_USER_SERMON_CLIP_POST_OR_FREE_TEXT_IDENTIFIERS";
  evidenceLabel: PilotEvidenceLabel;
  evidenceSummary: string;
  stopState: PilotStopState;
  stopConditions: PilotStopCondition[];
  totals: Omit<PilotWeeklyCohortAggregate, "weekStart"> & { weeksObserved: number };
  weekly: PilotWeeklyCohortAggregate[];
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

function safeCount(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error("Pilot aggregate counts must be non-negative finite numbers.");
  return value;
}

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : null;
}

function sum(rows: PilotChurchWeekObservation[], key: keyof PilotChurchWeekObservation): number {
  return rows.reduce((total, row) => total + safeCount(row[key] as number), 0);
}

export function aggregateWeeklyPilotCohort(
  observations: readonly PilotChurchWeekObservation[],
): PilotWeeklyCohortAggregate[] {
  const grouped = new Map<string, PilotChurchWeekObservation[]>();
  for (const observation of observations) {
    if (!ISO_DATE.test(observation.weekStart)) throw new Error("Pilot weekStart must be an ISO calendar date.");
    const rows = grouped.get(observation.weekStart) ?? [];
    rows.push({ ...observation });
    grouped.set(observation.weekStart, rows);
  }

  return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([weekStart, rows]) => {
    const activeChurches = rows.filter((row) => row.activeThisWeek).length;
    const onboardingObservedChurches = rows.filter((row) => row.onboardingComplete !== null).length;
    const sermonsStarted = sum(rows, "sermonsStarted");
    const suggestionTimingCount = sum(rows, "suggestionTimingSampleCount");
    const firstPreviewTimingCount = sum(rows, "firstPreviewTimingSampleCount");
    const supportMinutes = sum(rows, "supportMinutes");
    const completedWeeklyWorkflows = rows.filter((row) => row.weeklyWorkflowCompleted).length;
    const suggestionsReady = sum(rows, "suggestionsReady");
    const firstBrandedPreviewsReady = sum(rows, "firstBrandedPreviewReady");
    const fullContentSetsReady = sum(rows, "fullContentSetReady");

    return {
      weekStart,
      churchWeeksObserved: rows.length,
      activeChurches,
      onboardingEvidenceState: onboardingObservedChurches === 0
        ? "UNKNOWN"
        : onboardingObservedChurches === rows.length ? "KNOWN" : "PARTIAL",
      onboardingObservedChurches,
      onboardingCompleteChurches: rows.filter((row) => row.onboardingComplete).length,
      sermonsStarted,
      suggestionsReady,
      firstBrandedPreviewsReady,
      fullContentSetsReady,
      completedWeeklyWorkflows,
      suggestionReadyRate: rate(suggestionsReady, sermonsStarted),
      firstPreviewReadyRate: rate(firstBrandedPreviewsReady, sermonsStarted),
      fullContentReadyRate: rate(fullContentSetsReady, sermonsStarted),
      workflowCompletionRate: rate(completedWeeklyWorkflows, activeChurches),
      averageSuggestionMinutes: rate(sum(rows, "suggestionMinutesTotal"), suggestionTimingCount),
      suggestionTimingSamples: suggestionTimingCount,
      averageFirstPreviewMinutes: rate(sum(rows, "firstPreviewMinutesTotal"), firstPreviewTimingCount),
      firstPreviewTimingSamples: firstPreviewTimingCount,
      supportIncidents: sum(rows, "supportIncidentCount"),
      supportMinutes,
      supportMinutesPerActiveChurch: rate(supportMinutes, activeChurches),
      criticalIncidents: sum(rows, "criticalIncidentCount"),
      pastoralAccuracyIncidents: sum(rows, "pastoralAccuracyIncidentCount"),
      privacySecurityIncidents: sum(rows, "privacySecurityIncidentCount"),
    };
  });
}

function combineWeekly(weekly: PilotWeeklyCohortAggregate[]): PilotBoardExport["totals"] {
  const aggregate = <K extends keyof PilotWeeklyCohortAggregate>(key: K): number => (
    weekly.reduce((total, row) => total + (typeof row[key] === "number" ? row[key] as number : 0), 0)
  );
  const sermonsStarted = aggregate("sermonsStarted");
  const activeChurches = aggregate("activeChurches");
  const onboardingObservedChurches = aggregate("onboardingObservedChurches");
  const suggestionSamples = aggregate("suggestionTimingSamples");
  const previewSamples = aggregate("firstPreviewTimingSamples");
  const suggestionsReady = aggregate("suggestionsReady");
  const firstBrandedPreviewsReady = aggregate("firstBrandedPreviewsReady");
  const fullContentSetsReady = aggregate("fullContentSetsReady");
  const completedWeeklyWorkflows = aggregate("completedWeeklyWorkflows");
  const supportMinutes = aggregate("supportMinutes");

  return {
    weeksObserved: weekly.length,
    churchWeeksObserved: aggregate("churchWeeksObserved"),
    activeChurches,
    onboardingEvidenceState: onboardingObservedChurches === 0
      ? "UNKNOWN"
      : onboardingObservedChurches === aggregate("churchWeeksObserved") ? "KNOWN" : "PARTIAL",
    onboardingObservedChurches,
    onboardingCompleteChurches: aggregate("onboardingCompleteChurches"),
    sermonsStarted,
    suggestionsReady,
    firstBrandedPreviewsReady,
    fullContentSetsReady,
    completedWeeklyWorkflows,
    suggestionReadyRate: rate(suggestionsReady, sermonsStarted),
    firstPreviewReadyRate: rate(firstBrandedPreviewsReady, sermonsStarted),
    fullContentReadyRate: rate(fullContentSetsReady, sermonsStarted),
    workflowCompletionRate: rate(completedWeeklyWorkflows, activeChurches),
    averageSuggestionMinutes: suggestionSamples > 0
      ? Number((weekly.reduce((total, row) => total + ((row.averageSuggestionMinutes ?? 0) * row.suggestionTimingSamples), 0) / suggestionSamples).toFixed(2))
      : null,
    suggestionTimingSamples: suggestionSamples,
    averageFirstPreviewMinutes: previewSamples > 0
      ? Number((weekly.reduce((total, row) => total + ((row.averageFirstPreviewMinutes ?? 0) * row.firstPreviewTimingSamples), 0) / previewSamples).toFixed(2))
      : null,
    firstPreviewTimingSamples: previewSamples,
    supportIncidents: aggregate("supportIncidents"),
    supportMinutes,
    supportMinutesPerActiveChurch: rate(supportMinutes, activeChurches),
    criticalIncidents: aggregate("criticalIncidents"),
    pastoralAccuracyIncidents: aggregate("pastoralAccuracyIncidents"),
    privacySecurityIncidents: aggregate("privacySecurityIncidents"),
  };
}

function buildStopConditions(totals: PilotBoardExport["totals"]): PilotStopCondition[] {
  return [
    {
      id: "privacy-security-incident",
      state: "STOP_PILOT",
      triggered: totals.privacySecurityIncidents > 0,
      summary: "Stop expansion for any confirmed cross-tenant, privacy, or security incident until containment and review are complete.",
    },
    {
      id: "pastoral-accuracy-incident",
      state: "PAUSE_PILOT",
      triggered: totals.pastoralAccuracyIncidents > 0,
      summary: "Pause affected workflows for any material pastoral-accuracy incident until the safeguard and recovery are verified.",
    },
    {
      id: "critical-support-incident",
      state: "PAUSE_PILOT",
      triggered: totals.criticalIncidents > 0,
      summary: "Pause cohort expansion while a critical support incident remains in the measured period.",
    },
    {
      id: "workflow-reliability",
      state: "PAUSE_PILOT",
      triggered: totals.sermonsStarted >= 5 && (totals.firstPreviewReadyRate ?? 0) < 0.7,
      summary: "Pause expansion when fewer than 70% of started sermons produce a first branded preview in a measurable sample.",
    },
    {
      id: "operator-load",
      state: "WATCH",
      triggered: totals.activeChurches >= 5 && (totals.supportMinutesPerActiveChurch ?? 0) > 120,
      summary: "Review staffing and product friction when support exceeds two hours per active church-week.",
    },
  ];
}

function strongestStopState(conditions: PilotStopCondition[], insufficient: boolean): PilotStopState {
  if (conditions.some((condition) => condition.triggered && condition.state === "STOP_PILOT")) return "STOP_PILOT";
  if (conditions.some((condition) => condition.triggered && condition.state === "PAUSE_PILOT")) return "PAUSE_PILOT";
  if (conditions.some((condition) => condition.triggered && condition.state === "WATCH")) return "WATCH";
  return insufficient ? "CONTINUE_WITH_LIMITS" : "CONTINUE_PILOT";
}

export function buildPilotBoardExport(input: {
  observations: readonly PilotChurchWeekObservation[];
  generatedAt?: Date;
}): PilotBoardExport {
  const weekly = aggregateWeeklyPilotCohort(input.observations);
  const totals = combineWeekly(weekly);
  const insufficient = totals.churchWeeksObserved < 10 || totals.weeksObserved < 2 || totals.sermonsStarted < 5;
  const stopConditions = buildStopConditions(totals);

  return {
    schemaVersion: 1,
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    scope: "PILOT_COHORT_AGGREGATE",
    privacy: "NO_CHURCH_USER_SERMON_CLIP_POST_OR_FREE_TEXT_IDENTIFIERS",
    evidenceLabel: insufficient ? "INSUFFICIENT_SAMPLE" : "PILOT_DIRECTIONAL",
    evidenceSummary: insufficient
      ? "The sample is too small for launch claims. Treat these figures as operational pilot observations only."
      : "Directional pilot evidence only; it is not a production SLA, causal result, or broad-market benchmark.",
    stopState: strongestStopState(stopConditions, insufficient),
    stopConditions,
    totals,
    weekly,
  };
}

const CSV_COLUMNS = [
  "week_start", "evidence_label", "stop_state", "church_weeks_observed", "active_churches",
  "onboarding_evidence_state", "onboarding_observed_churches", "onboarding_complete_churches",
  "sermons_started", "suggestions_ready", "first_branded_previews_ready", "full_content_sets_ready",
  "workflow_completion_rate", "average_suggestion_minutes", "average_first_preview_minutes",
  "support_incidents", "support_minutes", "critical_incidents", "pastoral_accuracy_incidents",
  "privacy_security_incidents",
] as const;

function csvCell(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  return /[",\n\r]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}

export function serializePilotBoardCsv(report: PilotBoardExport): string {
  const rows = report.weekly.map((week) => [
    week.weekStart,
    report.evidenceLabel,
    report.stopState,
    week.churchWeeksObserved,
    week.activeChurches,
    week.onboardingEvidenceState,
    week.onboardingObservedChurches,
    week.onboardingCompleteChurches,
    week.sermonsStarted,
    week.suggestionsReady,
    week.firstBrandedPreviewsReady,
    week.fullContentSetsReady,
    week.workflowCompletionRate,
    week.averageSuggestionMinutes,
    week.averageFirstPreviewMinutes,
    week.supportIncidents,
    week.supportMinutes,
    week.criticalIncidents,
    week.pastoralAccuracyIncidents,
    week.privacySecurityIncidents,
  ].map(csvCell).join(","));
  return [CSV_COLUMNS.join(","), ...rows].join("\n");
}

export function serializePilotBoardJson(report: PilotBoardExport): string {
  return JSON.stringify(report, null, 2);
}
