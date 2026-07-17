export type OpenAIChatTask =
  | "clipSelection"
  | "clipRepair"
  | "sermonIntelligence"
  | "ministryMoment"
  | "contentMultiplication"
  | "clipQuality"
  | "clipCompleteness";

// Keep this aligned with the installed Chat Completions SDK. GPT-5.6 `max`
// reasoning is currently a Responses API capability; this app uses Chat
// Completions and intentionally defaults to `high`.
export type OpenAIReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

const DEFAULT_PREMIUM_CHAT_MODEL = "gpt-5.6-sol";
const DEFAULT_PREMIUM_REASONING_EFFORT: OpenAIReasoningEffort = "high";

const DEFAULT_CHAT_MODEL_BY_TASK: Record<OpenAIChatTask, string> = {
  clipSelection: DEFAULT_PREMIUM_CHAT_MODEL,
  clipRepair: DEFAULT_PREMIUM_CHAT_MODEL,
  sermonIntelligence: DEFAULT_PREMIUM_CHAT_MODEL,
  ministryMoment: DEFAULT_PREMIUM_CHAT_MODEL,
  contentMultiplication: DEFAULT_PREMIUM_CHAT_MODEL,
  clipQuality: DEFAULT_PREMIUM_CHAT_MODEL,
  clipCompleteness: DEFAULT_PREMIUM_CHAT_MODEL,
};

const ENV_BY_TASK: Record<OpenAIChatTask, string> = {
  clipSelection: "OPENAI_CLIP_SELECTION_MODEL",
  clipRepair: "OPENAI_CLIP_REPAIR_MODEL",
  sermonIntelligence: "OPENAI_SERMON_INTELLIGENCE_MODEL",
  ministryMoment: "OPENAI_MINISTRY_MOMENT_MODEL",
  contentMultiplication: "OPENAI_CONTENT_MULTIPLICATION_MODEL",
  clipQuality: "OPENAI_CLIP_QUALITY_MODEL",
  clipCompleteness: "OPENAI_CLIP_COMPLETENESS_MODEL",
};

const REASONING_ENV_BY_TASK: Record<OpenAIChatTask, string> = {
  clipSelection: "OPENAI_CLIP_SELECTION_MODEL_REASONING_EFFORT",
  clipRepair: "OPENAI_CLIP_REPAIR_MODEL_REASONING_EFFORT",
  sermonIntelligence: "OPENAI_SERMON_INTELLIGENCE_MODEL_REASONING_EFFORT",
  ministryMoment: "OPENAI_MINISTRY_MOMENT_MODEL_REASONING_EFFORT",
  contentMultiplication: "OPENAI_CONTENT_MULTIPLICATION_MODEL_REASONING_EFFORT",
  clipQuality: "OPENAI_CLIP_QUALITY_MODEL_REASONING_EFFORT",
  clipCompleteness: "OPENAI_CLIP_COMPLETENESS_MODEL_REASONING_EFFORT",
};

export function resolveOpenAIChatModel(task: OpenAIChatTask): string {
  const taskOverride = process.env[ENV_BY_TASK[task]]?.trim();
  if (taskOverride) {
    return taskOverride;
  }

  const globalOverride = process.env.OPENAI_CHAT_MODEL?.trim();
  return globalOverride || DEFAULT_CHAT_MODEL_BY_TASK[task];
}

function isReasoningModel(model: string): boolean {
  return /^gpt-5(?:\.|-|$)/i.test(model.trim());
}

function isReasoningEffort(value: string): value is OpenAIReasoningEffort {
  return ["none", "minimal", "low", "medium", "high", "xhigh"].includes(value);
}

export function resolveOpenAIReasoningEffort(
  task: OpenAIChatTask,
  model = resolveOpenAIChatModel(task),
): OpenAIReasoningEffort | undefined {
  if (!isReasoningModel(model)) {
    return undefined;
  }

  const legacyContentOverride = task === "contentMultiplication"
    ? process.env.OPENAI_CONTENT_MULTIPLICATION_REASONING_EFFORT
    : undefined;
  const taskOverride = (process.env[REASONING_ENV_BY_TASK[task]] ?? legacyContentOverride)
    ?.trim()
    .toLowerCase();
  if (taskOverride && isReasoningEffort(taskOverride)) {
    return taskOverride;
  }

  const globalOverride = process.env.OPENAI_REASONING_EFFORT?.trim().toLowerCase();
  if (globalOverride && isReasoningEffort(globalOverride)) {
    return globalOverride;
  }

  return DEFAULT_PREMIUM_REASONING_EFFORT;
}
