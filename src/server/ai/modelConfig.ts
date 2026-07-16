export type OpenAIChatTask =
  | "clipSelection"
  | "clipRepair"
  | "sermonIntelligence"
  | "ministryMoment"
  | "contentMultiplication"
  | "clipQuality"
  | "clipCompleteness";

const DEFAULT_CHAT_MODEL_BY_TASK: Record<OpenAIChatTask, string> = {
  clipSelection: "gpt-4o-mini",
  clipRepair: "gpt-4o-mini",
  sermonIntelligence: "gpt-4o-mini",
  ministryMoment: "gpt-4o-mini",
  contentMultiplication: "gpt-5.4",
  clipQuality: "gpt-4o-mini",
  clipCompleteness: "gpt-4o-mini",
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

export function resolveOpenAIChatModel(task: OpenAIChatTask): string {
  const taskOverride = process.env[ENV_BY_TASK[task]]?.trim();
  if (taskOverride) {
    return taskOverride;
  }

  const globalOverride = process.env.OPENAI_CHAT_MODEL?.trim();
  return globalOverride || DEFAULT_CHAT_MODEL_BY_TASK[task];
}
