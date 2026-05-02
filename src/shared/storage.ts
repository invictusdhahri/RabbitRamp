import {
  AIProvider,
  DEFAULT_SETTINGS,
  Settings,
} from "./types";
import * as logger from "./logger";

/** Try order when multiple providers have keys (env + defaults). */
const PROVIDER_TRY_ORDER: AIProvider[] = ["openai", "anthropic", "gemini"];

function envApiKey(provider: AIProvider): string {
  const raw =
    provider === "openai"
      ? import.meta.env.VITE_OPENAI_API_KEY
      : provider === "anthropic"
        ? import.meta.env.VITE_ANTHROPIC_API_KEY
        : import.meta.env.VITE_GEMINI_API_KEY;
  return typeof raw === "string" ? raw.trim() : "";
}

const STALE_MODEL_MAP: Record<string, string> = {
  "claude-3-5-haiku-20241022": "claude-haiku-4-5-20251001",
  "claude-3-5-sonnet-20241022": "claude-sonnet-4-5-20250929",
  "claude-3-opus-20240229": "claude-opus-4-20250514",
  "gemini-1.5-pro": "gemini-2.0-flash",
  "gemini-1.5-flash": "gemini-2.0-flash",
  "gemini-1.5-pro-latest": "gemini-2.0-flash",
  "gemini-1.5-flash-latest": "gemini-2.0-flash",
};

function migrateStaleModels(settings: Settings): Settings {
  const providers = { ...settings.providers };
  for (const id of PROVIDER_TRY_ORDER) {
    const current = providers[id].model;
    const replacement = STALE_MODEL_MAP[current];
    if (replacement) {
      providers[id] = { ...providers[id], model: replacement };
      logger.warn("storage", `migrated stale model "${current}" → "${replacement}" for ${id}`);
    }
  }
  return { ...settings, providers };
}

/** If an env key is present, it is always the source of truth — override stored key and force-enable. */
function applyEnvApiKeys(settings: Settings): Settings {
  const providers = { ...settings.providers };
  const overridden: AIProvider[] = [];
  for (const id of PROVIDER_TRY_ORDER) {
    const fromEnv = envApiKey(id);
    if (fromEnv) {
      providers[id] = { ...providers[id], apiKey: fromEnv, enabled: true };
      overridden.push(id);
    }
  }
  let providerPriority = settings.providerPriority;
  if (overridden.length > 0) {
    const fromEnv = new Set(overridden);
    const front = PROVIDER_TRY_ORDER.filter((id) => fromEnv.has(id));
    const rest = settings.providerPriority.filter((id) => !fromEnv.has(id));
    providerPriority = [...front, ...rest];
    logger.log("storage", "provider try order: .env providers first (canonical)", {
      order: providerPriority,
    });
  }
  if (overridden.length > 0) {
    logger.log("storage", "API keys from .env applied (masked)", { providers: overridden });
  }
  return { ...settings, providers, providerPriority };
}

function mergeStored(stored: Partial<Settings>): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    providers: {
      ...DEFAULT_SETTINGS.providers,
      ...(stored.providers ?? {}),
    },
    skills: {
      ...DEFAULT_SETTINGS.skills,
      ...(stored.skills ?? {}),
    },
  };
}

export async function getSettings(): Promise<Settings> {
  return new Promise((resolve) => {
    chrome.storage.sync.get("settings", (result) => {
      const stored = result["settings"] as Partial<Settings> | undefined;
      if (!stored) {
        resolve(applyEnvApiKeys(DEFAULT_SETTINGS));
        return;
      }
      resolve(migrateStaleModels(applyEnvApiKeys(mergeStored(stored))));
    });
  });
}

export async function saveSettings(settings: Settings): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ settings }, resolve);
  });
}

export async function patchSettings(
  patch: Partial<Settings>
): Promise<Settings> {
  const current = await getSettings();
  const updated: Settings = { ...current, ...patch };
  await saveSettings(updated);
  return updated;
}
