import type { AIFetchOptions } from "../../shared/types";

const DEFAULT_MAX_TOKENS = 2048;
const AI_FETCH_TIMEOUT_MS = 120_000;

export async function askGemini(
  prompt: string,
  apiKey: string,
  model: string,
  opts?: AIFetchOptions
): Promise<string> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_FETCH_TIMEOUT_MS);
  const maxTokens = opts?.maxOutputTokens ?? DEFAULT_MAX_TOKENS;
  const jsonHint =
    opts?.jsonObjectResponse === true
      ? "\nOutput only one JSON object. First character must be `{`."
      : "";
  const generationConfig: Record<string, unknown> = {
    temperature: 0.1,
    maxOutputTokens: maxTokens,
  };
  if (opts?.jsonObjectResponse) {
    generationConfig.responseMimeType = "application/json";
  }

  let res: Response;
  try {
    res = await fetch(endpoint, {
      signal: controller.signal,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text: "You are an expert educational assistant. Always respond with valid JSON only, no markdown fences.",
            },
          ],
        },
        contents: [{ parts: [{ text: prompt + jsonHint }] }],
        generationConfig,
      }),
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini ${res.status}: ${err}`);
  }

  const data: unknown = await res.json();
  const cands =
    data && typeof data === "object" && "candidates" in data
      ? (data as { candidates?: unknown[] }).candidates
      : undefined;
  const first = Array.isArray(cands) && cands.length > 0 ? cands[0] : undefined;
  const parts =
    first &&
    typeof first === "object" &&
    first !== null &&
    "content" in first &&
    (first as { content?: { parts?: unknown } }).content &&
    typeof (first as { content: { parts?: unknown } }).content === "object"
      ? (first as { content: { parts?: Array<{ text?: string }> } }).content?.parts
      : undefined;
  const t =
    Array.isArray(parts) && parts[0] && typeof parts[0].text === "string"
      ? parts[0].text.trim()
      : "";

  if (!t) {
    throw new Error(
      "Gemini returned no candidate text (safety block, PROHIBITED_CONTENT, or empty parts)."
    );
  }
  return t;
}

export async function testGemini(
  apiKey: string,
  model: string
): Promise<void> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: "Reply with: ok" }] }],
      generationConfig: { maxOutputTokens: 5 },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini ${res.status}: ${err}`);
  }
}
