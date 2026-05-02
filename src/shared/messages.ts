import {
  AIProvider,
  CourseContext,
  CourseItem,
  SkillResult,
  SkillType,
} from "./types";

// ─── Message types ────────────────────────────────────────────────────────────

export type Message =
  | { type: "COURSE_CONTEXT_UPDATED"; payload: CourseContext }
  | { type: "RUN_SKILL"; payload: { skill: SkillType } }
  | { type: "RUN_ALL_SKILLS" }
  | { type: "SKILL_STATUS"; payload: SkillResult }
  | { type: "GET_COURSE_CONTEXT" }
  | { type: "SCRAPE_COURSE_ITEMS" }
  | { type: "COURSE_ITEMS_RESULT"; payload: CourseItem[] }
  | {
      type: "AI_REQUEST";
      payload: {
        prompt: string;
        preferredProvider?: AIProvider;
        /** Cap output size for short JSON (e.g. quiz). Default ~2048 in providers. */
        maxOutputTokens?: number;
        /** Prefer strict JSON from providers that support it (OpenAI, Gemini). */
        jsonObjectResponse?: boolean;
      };
    }
  | { type: "AI_RESPONSE"; payload: { text: string; provider: AIProvider } }
  | { type: "AI_ERROR"; payload: { error: string } }
  | { type: "TEST_PROVIDER"; payload: { provider: AIProvider } }
  | { type: "TEST_PROVIDER_RESULT"; payload: { provider: AIProvider; ok: boolean; error?: string } }
  /** Starts processing `items` in `tabId` — orchestration lives in the service worker (survives popup close). */
  | { type: "QUEUE_START"; payload: { tabId: number; items: CourseItem[] } }
  /** Arm “Get Degree”: next home load on this tab triggers scrape + queue (call before navigating). */
  | { type: "GET_DEGREE_ARM"; payload: { tabId: number } }
  /** Popup sync: current queue snapshot (null if idle). */
  | { type: "QUEUE_GET_STATE" }
  | {
      type: "QUEUE_STATE";
      payload: {
        running: boolean;
        queueIndex: number | null;
        queuedRunTotal: number;
        getDegreePhase: null | "navigating" | "scraping" | "running";
      };
    }
  /** Progress / log line for open extension UIs */
  | { type: "QUEUE_LOG"; payload: { message: string } }
  | {
      type: "QUEUE_PROGRESS";
      payload: {
        index: number;
        total: number;
        running: boolean;
        getDegreePhase?: null | "navigating" | "scraping" | "running";
      };
    };

// ─── Typed wrappers ───────────────────────────────────────────────────────────

export function sendToBackground<T = unknown>(
  message: Message
): Promise<T> {
  // Use the callback form — the Promise API has a Chrome MV3 bug where it can
  // hang even after sendResponse() is called. The callback form always fires.
  return new Promise<T>((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: T) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

export function sendToTab<T = unknown>(
  tabId: number,
  message: Message
): Promise<T> {
  return chrome.tabs.sendMessage(tabId, message) as Promise<T>;
}
