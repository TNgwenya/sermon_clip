export type OpenAIChatTask =
  | "clipSelection"
  | "clipRepair"
  | "sermonIntelligence"
  | "ministryMoment"
  | "contentMultiplication"
  | "clipQuality"
  | "clipCompleteness";

export type OpenAIReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

const DEFAULT_CHAT_MODEL_BY_TASK: Record<OpenAIChatTask, string> = {
  clipSelection: "gpt-5.6-terra",
  clipRepair: "gpt-5.6-luna",
  sermonIntelligence: "gpt-5.6-terra",
  ministryMoment: "gpt-5.6-luna",
  contentMultiplication: "gpt-5.6-luna",
  clipQuality: "gpt-5.6-luna",
  clipCompleteness: "gpt-5.6-luna",
};

const DEFAULT_REASONING_EFFORT_BY_TASK: Record<OpenAIChatTask, OpenAIReasoningEffort> = {
  clipSelection: "medium",
  clipRepair: "low",
  sermonIntelligence: "medium",
  ministryMoment: "low",
  contentMultiplication: "low",
  clipQuality: "low",
  clipCompleteness: "low",
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

  return DEFAULT_REASONING_EFFORT_BY_TASK[task];
}
