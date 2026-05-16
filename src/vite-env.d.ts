/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OPENAI_API_KEY?: string;
  readonly VITE_ANTHROPIC_API_KEY?: string;
  readonly VITE_GEMINI_API_KEY?: string;
  readonly VITE_GROQ_API_KEY?: string;
}
