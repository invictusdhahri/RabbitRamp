import type { AIFetchOptions } from "../../shared/types";

const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_MAX_TOKENS = 2048;
/** Anthropic often needs >1m (cold start, load, longer outputs). */
const AI_FETCH_TIMEOUT_MS = 180_000;

function resolveAnthropicModel(model: string): string {
  return model.trim() || DEFAULT_ANTHROPIC_MODEL;
}

export async function askAnthropic(
  prompt: string,
  apiKey: string,
  model: string,
  opts?: AIFetchOptions
): Promise<string> {
  const resolved = resolveAnthropicModel(model);
  const maxTokens = opts?.maxOutputTokens ?? DEFAULT_MAX_TOKENS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_FETCH_TIMEOUT_MS);
  const structured =
    opts?.jsonObjectResponse === true
      ? "\nYour entire reply must be one JSON object only. Output must begin with `{` immediately — no introductions, apologies, or markdown."
      : "";

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      signal: controller.signal,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: resolved,
        max_tokens: maxTokens,
        system:
          "You are an expert educational assistant. Always respond with valid JSON only, no markdown fences.",
        messages: [{ role: "user", content: prompt + structured }],
      }),
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic ${res.status}: ${err}`);
  }

  const data: unknown = await res.json();
  const blocks =
    data && typeof data === "object" && "content" in data
      ? (data as { content?: Array<{ type?: string; text?: string }> }).content
      : undefined;

  let textPayload = "";
  if (Array.isArray(blocks)) {
    const tb = blocks.find((b) => b?.type === "text" && typeof b.text === "string");
    if (tb?.text) textPayload = tb.text.trim();
    else if (blocks[0]?.text && typeof blocks[0].text === "string") {
      textPayload = blocks[0].text.trim();
    }
  }

  if (!textPayload) {
    throw new Error(
      "Anthropic returned no text content (blocked, stop_reason, or non-text blocks)."
    );
  }
  return textPayload;
}

export async function testAnthropic(
  apiKey: string,
  model: string
): Promise<void> {
  const resolved = resolveAnthropicModel(model);
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: resolved,
      max_tokens: 5,
      messages: [{ role: "user", content: "Reply with: ok" }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic ${res.status}: ${err}`);
  }
}
