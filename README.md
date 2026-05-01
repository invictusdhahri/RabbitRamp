# CoursCheat

A Chrome extension that automates Coursera coursework using AI — skip videos and readings, solve quizzes, and write assignments with one click.

## Features

| Skill | What it does |
|---|---|
| **Video Skipper** | Jumps to the end of lecture videos instantly |
| **Reading Skipper** | Marks reading items as complete without scrolling through them |
| **Quiz Solver** | Parses quiz questions and fills answers via AI (multiple-choice, checkbox, and free-text) |
| **Assignment Writer** | Drafts peer-graded assignment responses using AI |
| **Form Filler** | Completes survey/reflection forms automatically |

Additional options: **auto-submit**, **auto-next** (navigates to the next item after completion), and a configurable **delay** between actions.

## AI Providers

CoursCheat routes requests through whichever providers you enable, in priority order:

- **OpenAI** — default model `gpt-4o`
- **Anthropic** — default model `claude-3-5-haiku-20241022`
- **Google Gemini** — default model `gemini-1.5-pro`

API keys are stored locally in Chrome's `sync` storage and never sent anywhere except the provider's own API endpoint.

## Setup

### Prerequisites

- Node.js ≥ 18
- pnpm (or npm)

### Install dependencies

```bash
pnpm install
```

### Configure API keys (for development builds)

Copy `.env.example` to `.env` and fill in at least one key:

```bash
cp .env.example .env
```

```env
VITE_OPENAI_API_KEY=sk-...
VITE_ANTHROPIC_API_KEY=sk-ant-...
VITE_GEMINI_API_KEY=...
```

> **Note:** `VITE_*` values are inlined at build time. Never commit a `.env` file that contains real keys, and never distribute a build that was made with keys baked in. In production, users enter their own keys in the extension's Options page.

### Build

```bash
# One-off build
pnpm build

# Watch mode (rebuilds on save)
pnpm dev
```

The built extension is output to `dist/`.

### Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select the `dist/` folder

## Usage

1. Open the extension's **Options** page and add at least one AI provider API key.
2. Navigate to any Coursera course item (video, reading, quiz, or assignment).
3. Click the extension icon to open the popup.
4. Click **Run All** to let the extension handle the current item automatically, or trigger individual skills manually.

A floating status bar on the page shows live progress.

## Project Structure

```
src/
├── background/         # Service worker — AI routing & provider adapters
│   └── ai/             # openai.ts · anthropic.ts · gemini.ts · router.ts
├── content/            # Content script — DOM interaction
│   ├── detector.ts     # Detects current item type (video / quiz / …)
│   ├── overlay/        # Floating status bar UI
│   ├── skills/         # One file per skill (quizSolver, videoSkipper, …)
│   └── utils/          # DOM helpers (setReactInput, clickNext, …)
├── options/            # Options page (React)
├── popup/              # Popup UI (React)
└── shared/             # Types, storage helpers, message bus
```

## Tech Stack

- **Vite** + **@crxjs/vite-plugin** — Chrome extension build pipeline
- **React 18** — Options and Popup UIs
- **Tailwind CSS v4** — Styling
- **TypeScript** — End-to-end type safety

## License

MIT
