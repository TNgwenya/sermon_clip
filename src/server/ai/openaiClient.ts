import OpenAI from "openai";

export function getOpenAiClient(missingKeyMessage = "OPENAI_API_KEY is missing."): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(missingKeyMessage);
  }

  return new OpenAI({ apiKey });
}
