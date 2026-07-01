import OpenAI from "openai";

function resolveOpenAiTimeoutMs(): number | undefined {
  const configured = process.env.OPENAI_TIMEOUT_MS?.trim();
  if (!configured) {
    return undefined;
  }

  const timeoutMs = Number(configured);
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : undefined;
}

export function getOpenAiClient(missingKeyMessage = "OPENAI_API_KEY is missing."): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(missingKeyMessage);
  }

  return new OpenAI({
    apiKey,
    timeout: resolveOpenAiTimeoutMs(),
  });
}
