import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "CoursCheat — Coursera Autopilot",
  version: "1.0.0",
  description:
    "Skip videos & readings, solve quizzes, write assignments and fill forms on Coursera — powered by OpenAI, Anthropic, and Gemini.",
  icons: {
    "16": "icons/icon16.png",
    "32": "icons/icon32.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png",
  },
  action: {
    default_popup: "src/popup/index.html",
    default_icon: {
      "16": "icons/icon16.png",
      "32": "icons/icon32.png",
      "48": "icons/icon48.png",
    },
  },
  options_ui: {
    page: "src/options/index.html",
    open_in_tab: true,
  },
  background: {
    service_worker: "src/background/service-worker.ts",
    type: "module",
  },
  content_scripts: [
    {
      matches: ["https://www.coursera.org/*"],
      js: ["src/content/index.ts"],
      run_at: "document_idle",
    },
  ],
  host_permissions: [
    "https://www.coursera.org/*",
    "https://api.openai.com/*",
    "https://api.anthropic.com/*",
    "https://generativelanguage.googleapis.com/*",
  ],
  permissions: ["storage", "tabs", "activeTab"],
  web_accessible_resources: [
    {
      resources: ["icons/*.png"],
      matches: ["https://www.coursera.org/*"],
    },
  ],
});
