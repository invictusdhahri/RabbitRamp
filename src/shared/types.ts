// ─── Item / page types ───────────────────────────────────────────────────────

export type ItemType =
  | "video"
  | "reading"
  | "quiz"
  | "assignment"
  | "form"
  | "unknown";

export interface CourseContext {
  courseName: string;
  weekLabel: string;
  itemTitle: string;
  itemType: ItemType;
  url: string;
}

export interface CourseItem {
  title: string;
  url: string;
  itemType: ItemType;
  completed?: boolean;
}

// ─── Skills ──────────────────────────────────────────────────────────────────

export type SkillType =
  | "videoSkipper"
  | "readingSkipper"
  | "quizSolver"
  | "assignmentWriter"
  | "formFiller";

export type SkillStatus =
  | "idle"
  | "running"
  | "done"
  | "error";

export interface SkillResult {
  skill: SkillType;
  status: SkillStatus;
  message: string;
}

// ─── Quiz structures ──────────────────────────────────────────────────────────

export interface QuizOption {
  index: number;
  text: string;
}

export interface QuizQuestion {
  index: number;
  text: string;
  type: "multiple-choice" | "checkbox" | "text";
  options: QuizOption[];
}

export interface AIQuizRequest {
  questions: QuizQuestion[];
}

export interface AIQuizResponse {
  answers: (number | number[] | string)[];
}

/** Optional tuning for background AI calls (quiz uses compact output). */
export interface AIFetchOptions {
  maxOutputTokens?: number;
  jsonObjectResponse?: boolean;
}

// ─── AI Providers ─────────────────────────────────────────────────────────────

export type AIProvider = "openai" | "anthropic" | "gemini";

export interface AIProviderConfig {
  provider: AIProvider;
  apiKey: string;
  model: string;
  enabled: boolean;
}

// ─── Settings ────────────────────────────────────────────────────────────────

export interface Settings {
  providerPriority: AIProvider[];
  providers: Record<AIProvider, AIProviderConfig>;
  skills: Record<SkillType, boolean>;
  autoSubmit: boolean;
  autoNext: boolean;
  delayMs: number;
}

export const DEFAULT_SETTINGS: Settings = {
  providerPriority: ["openai", "anthropic", "gemini"],
  providers: {
    openai: {
      provider: "openai",
      apiKey: "",
      model: "gpt-4o",
      enabled: false,
    },
    anthropic: {
      provider: "anthropic",
      apiKey: "",
      model: "claude-haiku-4-5-20251001",
      enabled: false,
    },
    gemini: {
      provider: "gemini",
      apiKey: "",
      model: "gemini-2.0-flash",
      enabled: false,
    },
  },
  skills: {
    videoSkipper: true,
    readingSkipper: true,
    quizSolver: true,
    assignmentWriter: true,
    formFiller: true,
  },
  autoSubmit: true,
  autoNext: true,
  delayMs: 800,
};
