import { AIProvider, AIFetchOptions, Settings } from "../../shared/types";
import * as logger from "../../shared/logger";
import { askOpenAI } from "./openai";
import { askAnthropic } from "./anthropic";
import { askGemini } from "./gemini";
import { askGroq } from "./groq";


export async function routeAI(
  prompt: string,
  settings: Settings,
  preferredProvider?: AIProvider,
  fetchOpts?: AIFetchOptions
): Promise<{ text: string; provider: AIProvider }> {
  const priority = preferredProvider
    ? [
        preferredProvider,
        ...settings.providerPriority.filter((p) => p !== preferredProvider),
      ]
    : settings.providerPriority;

  const enabledProviders = priority.filter(
    (p) => settings.providers[p].enabled && settings.providers[p].apiKey
  );

  logger.log("router", "routeAI start", {
    preferredProvider,
    enabledCount: enabledProviders.length,
    tryOrder: enabledProviders,
  });

  if (enabledProviders.length === 0) {
    throw new Error(
      "No AI providers configured. Please add an API key in the Options page."
    );
  }

  let lastError: Error = new Error("Unknown error");
  const failureSummaries: string[] = [];

  for (const provider of enabledProviders) {
    const cfg = settings.providers[provider];
    try {
      logger.log("router", `calling ${provider}`, { model: cfg.model });
      let text: string;
      switch (provider) {
        case "openai":
          text = await askOpenAI(prompt, cfg.apiKey, cfg.model, fetchOpts);
          break;
        case "anthropic":
          text = await askAnthropic(prompt, cfg.apiKey, cfg.model, fetchOpts);
          break;
        case "gemini":
          text = await askGemini(prompt, cfg.apiKey, cfg.model, fetchOpts);
          break;
        case "groq":
          text = await askGroq(prompt, cfg.apiKey, cfg.model, fetchOpts);
          break;
      }
      logger.log("router", `success via ${provider}`);
      return { text, provider };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      failureSummaries.push(`${provider}: ${lastError.message}`);
      const isRateLimit =
        lastError.message.includes("429") ||
        lastError.message.toLowerCase().includes("rate");
      logger.warn(
        "router",
        `provider ${provider} failed (${isRateLimit ? "rate-limit" : "error"}); trying next`,
        lastError.message
      );
    }
  }

  logger.error("router", "all providers failed");
  throw new Error(
    failureSummaries.length > 0
      ? `All AI providers failed:\n${failureSummaries.join("\n")}`
      : lastError.message
  );
}

/**
 * Strip first ```json ... ``` (or generic ``` … ``` ) wrapper if present.
 */
function stripMarkdownJsonFence(raw: string): string {
  const fence = /\s*```(?:json)?\s*([\s\S]*?)```\s*/i.exec(raw.trim());
  if (fence) return fence[1].trim();
  return raw.trim();
}

/**
 * Slice first balanced `{ ... }` from text, or null (e.g. plain-text refusals: "I don't have…").
 */
export function sliceFirstJSONObject(raw: string): string | null {
  let body = stripMarkdownJsonFence(raw);
  const start = body.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  for (let i = start; i < body.length; i++) {
    if (body[i] === "{") depth++;
    else if (body[i] === "}") {
      depth--;
      if (depth === 0) return body.slice(start, i + 1);
    }
  }
  return null;
}

/** Legacy helper — prefers object slice; falls back so callers keep prior behavior without `{`. */
export function extractJSON(raw: string): string {
  return sliceFirstJSONObject(raw) ?? stripMarkdownJsonFence(raw);
}
