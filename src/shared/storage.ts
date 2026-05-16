import {
  AIProvider,
  DEFAULT_SETTINGS,
  Settings,
} from "./types";
import * as logger from "./logger";

/** Try order when multiple providers have keys (env + defaults). */
const PROVIDER_TRY_ORDER: AIProvider[] = ["groq", "openai", "anthropic", "gemini"];

function envApiKey(provider: AIProvider): string {
  const raw =
    provider === "openai"
      ? import.meta.env.VITE_OPENAI_API_KEY
      : provider === "anthropic"
        ? import.meta.env.VITE_ANTHROPIC_API_KEY
        : provider === "groq"
          ? import.meta.env.VITE_GROQ_API_KEY
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

/**
 * If an env key is present, it overrides that provider's stored key and enables it.
 *
 * We intentionally do NOT reorder `providerPriority` here — that made every reload
 * wipe the user's drag-order (Get Degree / Options) whenever any .env key existed.
 */
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
  if (overridden.length > 0) {
    logger.log("storage", "API keys from .env applied (masked)", { providers: overridden });
  }
  return { ...settings, providers };
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

/**
 * Strip provider configs that came from .env so we only persist keys the user
 * explicitly entered via the UI. Env keys are re-applied on every load by
 * applyEnvApiKeys(), so there is no need to store them — and not storing them
 * means the saved state won't look "wrong" if .env changes.
 */
function stripEnvKeys(settings: Settings): Settings {
  const providers = { ...settings.providers };
  for (const id of PROVIDER_TRY_ORDER) {
    const fromEnv = envApiKey(id);
    if (fromEnv && providers[id]?.apiKey === fromEnv) {
      providers[id] = { ...providers[id], apiKey: "", enabled: false };
    }
  }
  return { ...settings, providers };
}

function finalizeFromPartial(stored: Partial<Settings>): Settings {
  return migrateStaleModels(applyEnvApiKeys(mergeStored(stored)));
}

export async function getSettings(): Promise<Settings> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get("settings", (localResult) => {
      if (chrome.runtime.lastError) {
        logger.error("storage", "getSettings failed", chrome.runtime.lastError.message);
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      const local = localResult["settings"] as Partial<Settings> | undefined;

      if (local != null) {
        resolve(finalizeFromPartial(local));
        return;
      }

      // Older builds used chrome.storage.sync — one-time migrate so saves survive reload.
      chrome.storage.sync.get("settings", (syncResult) => {
        if (chrome.runtime.lastError) {
          logger.warn(
            "storage",
            "sync read failed during migration",
            chrome.runtime.lastError.message
          );
          resolve(applyEnvApiKeys(DEFAULT_SETTINGS));
          return;
        }

        const syncStored = syncResult["settings"] as Partial<Settings> | undefined;
        if (syncStored == null) {
          resolve(applyEnvApiKeys(DEFAULT_SETTINGS));
          return;
        }

        const finalized = finalizeFromPartial(syncStored);
        chrome.storage.local.set({ settings: stripEnvKeys(finalized) }, () => {
          if (chrome.runtime.lastError) {
            logger.warn(
              "storage",
              "migrate sync→local write failed",
              chrome.runtime.lastError.message
            );
          } else {
            logger.log("storage", "migrated settings chrome.storage.sync → local");
          }
          resolve(finalized);
        });
      });
    });
  });
}

export async function saveSettings(settings: Settings): Promise<void> {
  const toStore = stripEnvKeys(settings);
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ settings: toStore }, () => {
      if (chrome.runtime.lastError) {
        logger.error("storage", "saveSettings failed", chrome.runtime.lastError.message);
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
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
