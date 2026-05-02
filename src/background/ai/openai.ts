import type { AIFetchOptions } from "../../shared/types";

const DEFAULT_MAX_TOKENS = 2048;
const AI_FETCH_TIMEOUT_MS = 120_000;

export async function askOpenAI(
  prompt: string,
  apiKey: string,
  model: string,
  opts?: AIFetchOptions
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_FETCH_TIMEOUT_MS);
  const maxTokens = opts?.maxOutputTokens ?? DEFAULT_MAX_TOKENS;
  const useJson = opts?.jsonObjectResponse === true;
  const jsonUserSuffix = useJson
    ? "\n\nOutput: one raw JSON object only (no markdown). First character must be `{`."
    : "";

  let res: Response;
  try {
    const body: Record<string, unknown> = {
      model,
      messages: [
        {
          role: "system",
          content:
            "You are an expert educational assistant. Always respond with valid JSON only, no markdown fences.",
        },
        { role: "user", content: prompt + jsonUserSuffix },
      ],
      temperature: 0.1,
      max_tokens: maxTokens,
    };
    if (useJson) {
      body.response_format = { type: "json_object" };
    }
    res = await fetch("https://api.openai.com/v1/chat/completions", {
      signal: controller.signal,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok && useJson && res.status === 400) {
      const errText = await res.text();
      if (errText.toLowerCase().includes("response_format")) {
        delete body.response_format;
        res = await fetch("https://api.openai.com/v1/chat/completions", {
          signal: controller.signal,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
        });
      } else {
        throw new Error(`OpenAI ${res.status}: ${errText}`);
      }
    }
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI ${res.status}: ${err}`);
  }

  const data: unknown = await res.json();
  const content = (data as { choices?: Array<{ message?: { content?: string | null } }> })
    ?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error(
      "OpenAI returned no assistant text (empty choices or refusal). Check model and API response."
    );
  }
  return content.trim();
}

export async function testOpenAI(
  apiKey: string,
  model: string
): Promise<void> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Reply with: ok" }],
      max_tokens: 5,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI ${res.status}: ${err}`);
  }
}
