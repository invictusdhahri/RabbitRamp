import {
  AIQuizResponse,
  QuizQuestion,
  Settings,
} from "../../shared/types";
import { collectChoiceInputsDeep, SITE_CHROME_SELECTOR } from "../detector";
import { sliceFirstJSONObject } from "../../background/ai/router";
import * as logger from "../../shared/logger";
import { sendToBackground } from "../../shared/messages";
import {
  acceptCourseraHonorCode,
  bootstrapCourseraQuizEntry,
  dismissCourseraTimedAttemptModal,
  setReactInput,
  waitForCourseraSubmitConfirmation,
} from "../utils/dom";

async function pause(ms: number): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, ms));
}

/**
 * `.contains()` and `element.querySelector*()` do not see into descendant shadow roots.
 * Coursera choice inputs sometimes live inside design-system shadow trees.
 */
function composedBlockContains(block: HTMLElement, node: Node): boolean {
  let cur: Node | null = node;
  while (cur) {
    if (cur === block) return true;
    const root = cur.getRootNode();
    if (root instanceof ShadowRoot && root.host) {
      cur = root.host;
    } else if (cur.parentNode) {
      cur = cur.parentNode;
    } else {
      break;
    }
  }
  return false;
}

/** Radios/checkboxes under this submission block including shadow/iframes; excludes site chrome. */
function listChoicesInBlock(
  block: HTMLElement,
  type: "radio" | "checkbox"
): HTMLInputElement[] {
  const found = collectChoiceInputsDeep(block).filter((inp) => {
    if (inp.type !== type) return false;
    if (inp.closest(SITE_CHROME_SELECTOR)) return false;
    return composedBlockContains(block, inp);
  });
  // Same named group appears once per MCQ block — keep DOM/visual order stable.
  return found.sort((a, b) => {
    const ar = a.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    if (Math.abs(ar.top - br.top) > 1) return ar.top - br.top;
    return ar.left - br.left;
  });
}

/** Quiz answers are tiny JSON — cap tokens + strict JSON speeds up the model. */
const QUIZ_AI_MAX_OUTPUT = 896;

/** Compact prompt: fewer tokens than JSON.stringify(questions, null, 2). */
function buildCompactQuizPrompt(questions: QuizQuestion[]): string {
  const n = questions.length;
  const lines: string[] = [
    `Return ONLY a JSON object: {"answers":[...]} with exactly ${n} items in order.`,
    `multiple-choice → one number (0-based option index).`,
    `checkbox → array of 0-based indices. text → short string answer.`,
    "",
    "---",
  ];
  questions.forEach((q, i) => {
    const qtext = q.text.replace(/\s+/g, " ").trim();
    lines.push(`${i}. [${q.type}] ${qtext}`);
    for (const o of q.options) {
      const ot = o.text.replace(/\s+/g, " ").trim();
      lines.push(`   ${o.index}: ${ot}`);
    }
    lines.push("");
  });
  return lines.join("\n");
}

/**
 * Tiered block finder — mirrors the reference implementation.
 * Tier 1: explicit Coursera submission testids (most reliable)
 * Tier 2: generic question containers
 * Tier 3: textarea wrappers
 * Tier 4: radio/checkbox group wrappers
 */
function findBlocks(): HTMLElement[] {
  const seen = new Set<HTMLElement>();
  const results: HTMLElement[] = [];

  const add = (el: HTMLElement) => {
    if (!seen.has(el)) { seen.add(el); results.push(el); }
  };

  // Tier 1 — specific Coursera submission question types
  const tier1Selectors = [
    '[data-testid="part-Submission_MultipleChoiceQuestion"]',
    '[data-testid="part-Submission_CheckboxQuestion"]',
    '[data-testid="part-Submission_TextInputQuestion"]',
    '[data-testid="part-Submission_ReflectiveQuestion"]',
    '[data-testid="part-Submission_FreeFormTextQuestion"]',
    '[data-testid*="ReflectiveQuestion"]',
    '[data-testid*="FreeForm"]',
  ];
  for (const sel of tier1Selectors) {
    document.querySelectorAll<HTMLElement>(sel).forEach(add);
  }
  if (results.length) return results;

  // Tier 2 — generic question containers
  const tier2Selectors = [
    '[data-testid*="Question"]',
    '.rc-FormPartsQuestion',
    '[data-testid^="prompt"]',
    '.rc-QuestionForm',
    '.c-questionnaire-question',
    '.rc-QuestionnaireQuestion',
  ];
  for (const sel of tier2Selectors) {
    document.querySelectorAll<HTMLElement>(sel).forEach(add);
  }
  // De-nest: keep only leaf-most elements to avoid double-counting parents and children
  const deNested = results.filter(
    (el) => !results.some((o) => o !== el && o.contains(el))
  );
  if (deNested.length) return deNested;

  // Tier 3 — textarea wrappers
  document.querySelectorAll<HTMLTextAreaElement>("textarea").forEach((ta) => {
    let p: HTMLElement | null = ta;
    for (let i = 0; i < 12; i++) {
      p = p?.parentElement ?? null;
      if (!p) break;
      if (seen.has(p)) return;
      if (
        p.tagName === "DIV" &&
        (p.querySelector("p, label, h3, h4, legend") || p.getAttribute("data-testid"))
      ) {
        add(p);
        return;
      }
    }
  });
  if (results.length) return results;

  // Tier 4 — radio/checkbox group wrappers (Coursera may mount controls in shadow/iframes)
  collectChoiceInputsDeep(document.body).forEach((inp) => {
    if (inp.closest(SITE_CHROME_SELECTOR)) return;
    let p: HTMLElement | null = inp;
    for (let i = 0; i < 10; i++) {
      p = p?.parentElement ?? null;
      if (!p) break;
      if (
        p.querySelectorAll('input[type="radio"], input[type="checkbox"]').length >= 2
      ) {
        add(p);
        break;
      }
    }
  });

  return results;
}

/** Extract question text — mirrors reference getQuestion() */
function getQuestionText(block: HTMLElement, idx: number): string {
  // Standard Coursera legend with optional CML inner text
  const legend = block.querySelector<HTMLElement>('[data-testid="legend"]');
  const cml = legend?.querySelector<HTMLElement>(".rc-CML");
  const fromLegend = ((cml ?? legend)?.innerText ?? "")
    .replace(/^\d+\.\s*/, "")
    .replace(/\d+\s*points?\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (fromLegend) return fromLegend.slice(0, 1200);

  // Fallback — generic text nodes
  const fallbackEl = block.querySelector<HTMLElement>(
    ".rc-CMLViewer, [data-testid='question-text'], h1, h2, h3, h4, h5, p, label"
  );
  return (fallbackEl?.textContent?.replace(/\s+/g, " ").trim() ?? `Question ${idx + 1}`).slice(0, 1200);
}

/** Best-effort DOM hint for debugging (which tier matched the block). */
function blockDebugLabel(block: HTMLElement): string {
  const tid = block.getAttribute("data-testid");
  if (tid) return `data-testid="${tid}"`;
  const cls =
    typeof block.className === "string"
      ? block.className.split(/\s+/).filter(Boolean).slice(0, 4).join(" ")
      : "";
  if (cls) return `class="${cls}"`;
  return block.tagName.toLowerCase();
}

/** Extract option labels — uses .rc-Option first, then labels */
function getOptionLabels(block: HTMLElement): string[] {
  const rcOpts = block.querySelectorAll<HTMLElement>(".rc-Option");
  if (rcOpts.length >= 2) {
    return Array.from(rcOpts)
      .map((o) => (o.innerText ?? "").replace(/\s+/g, " ").trim())
      .filter(Boolean);
  }
  return Array.from(block.querySelectorAll<HTMLElement>("label"))
    .map((l) => (l.innerText ?? "").replace(/\s+/g, " ").trim())
    .filter((t) => t.length > 0 && t.length < 500);
}

export async function runQuizSolver(
  settings: Settings,
  onStatus: (msg: string) => void
): Promise<void> {
  onStatus("Waiting for quiz to load…");

  await bootstrapCourseraQuizEntry(1200, 5);

  logger.log("quizSolver", "runQuizSolver started", {
    href: typeof location !== "undefined" ? location.href : "",
  });
  let page = 1;
  let questionsHandledTotal = 0;

  while (true) {
    onStatus(`Parsing quiz page ${page}…`);

    const maxPoll = page === 1 ? 12 : 5;
    let questions = parseQuizPage();
    let poll = 0;
    while (questions.length === 0 && poll < maxPoll) {
      poll++;
      onStatus(`Waiting for questions (${poll}/${maxPoll})…`);
      await dismissCourseraTimedAttemptModal(700);
      await pause(450);
      questions = parseQuizPage();
    }

    if (questions.length === 0) {
      if (page === 1 && questionsHandledTotal === 0) {
        throw new Error(
          "No quiz questions appeared. Reflections / practice essays are usually opened with Write Assignment, not Solve Quiz."
        );
      }
      onStatus("No more questions on this page.");
      break;
    }

    questionsHandledTotal += questions.length;

    onStatus(`Asking AI for ${questions.length} answer(s)…`);
    const answers = await fetchAnswers(questions);

    onStatus("Filling answers…");
    await fillAnswers(questions, answers, settings);

    const nextPage = findQuizNextPage();
    if (nextPage) {
      onStatus(`Moving to quiz page ${page + 1}…`);
      nextPage.click();
      await pause(settings.delayMs + 600);
      page++;
    } else {
      break;
    }
  }

  if (questionsHandledTotal === 0) {
    throw new Error("Quiz solver did not find any answerable questions.");
  }

  await acceptCourseraHonorCode(settings);

  if (settings.autoSubmit) {
    onStatus("Submitting quiz…");
    await submitQuiz();
    await pause(settings.delayMs);
  }

  onStatus("Done.");
}

// ─── Parser ───────────────────────────────────────────────────────────────────

function parseQuizPage(): QuizQuestion[] {
  const questions: QuizQuestion[] = [];
  const blocks = findBlocks();

  logger.log("quizSolver", "findBlocks → DOM containers", {
    count: blocks.length,
    labels: blocks.map((b, i) => ({ i, label: blockDebugLabel(b) })),
  });

  blocks.forEach((block, idx) => {
    const text = getQuestionText(block, idx);

    const radioInputs = listChoicesInBlock(block, "radio");
    const checkboxInputs = listChoicesInBlock(block, "checkbox");
    const textInputs = block.querySelectorAll<HTMLInputElement>('input[type="text"], textarea');

    if (radioInputs.length > 0) {
      const optionLabels = getOptionLabels(block);
      const options = radioInputs.map((inp, i) => ({
        index: i,
        text:
          optionLabels[i] ??
          inp.closest("label")?.textContent?.trim() ??
          inp.getAttribute("aria-label") ??
          `Option ${i + 1}`,
      }));
      questions.push({ index: idx, text, type: "multiple-choice", options });
    } else if (checkboxInputs.length > 0) {
      const optionLabels = getOptionLabels(block);
      const options = checkboxInputs.map((inp, i) => ({
        index: i,
        text:
          optionLabels[i] ??
          inp.closest("label")?.textContent?.trim() ??
          inp.getAttribute("aria-label") ??
          `Option ${i + 1}`,
      }));
      questions.push({ index: idx, text, type: "checkbox", options });
    } else if (textInputs.length > 0) {
      questions.push({ index: idx, text, type: "text", options: [] });
    }
  });

  logger.log("quizSolver", "parseQuizPage → questions extracted", {
    count: questions.length,
    questions: questions.map((q) => ({
      index: q.index,
      type: q.type,
      textPreview: q.text.slice(0, 200) + (q.text.length > 200 ? "…" : ""),
      optionCount: q.options.length,
      options: q.options.map((o) => ({
        index: o.index,
        textPreview: o.text.slice(0, 120) + (o.text.length > 120 ? "…" : ""),
      })),
    })),
  });

  return questions;
}

/** Pad / trim so fillAnswers never indexes past the model output. */
function normalizeQuizAnswers(
  answers: AIQuizResponse["answers"],
  questions: QuizQuestion[]
): AIQuizResponse["answers"] {
  const n = questions.length;
  const out: AIQuizResponse["answers"] = Array.isArray(answers)
    ? answers.slice(0, n)
    : [];

  for (let i = out.length; i < n; i++) {
    const t = questions[i].type;
    if (t === "multiple-choice") out.push(0);
    else if (t === "checkbox") out.push([]);
    else out.push("");
  }
  return out;
}

// ─── AI call ─────────────────────────────────────────────────────────────────

async function fetchAnswers(
  questions: QuizQuestion[]
): Promise<AIQuizResponse["answers"]> {
  const base = buildCompactQuizPrompt(questions);
  const redoSuffix = `\n\nCRITICAL REDO: Respond with NOTHING except one JSON object. First character {. Schema: {"answers":[...]} with exactly ${questions.length} items in question order — index 0 aligns with question 0. Use numbers for single-choice indexes, arrays of numbers for checkbox, strings for fill-in.`;

  logger.log("quizSolver", "AI request → full prompt (base)", base);

  logger.log("quizSolver", "AI request → meta", {
    questionCount: questions.length,
    promptChars: base.length,
    maxOutputTokens: QUIZ_AI_MAX_OUTPUT,
    jsonObjectResponse: true,
  });

  let lastRaw = "";
  let lastProvider = "";
  let lastParseErr: unknown;

  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt = attempt === 0 ? base : base + redoSuffix;
    const t0 = performance.now();

    const response = await sendToBackground<{
      type: string;
      payload: { text?: string; provider?: string; error?: string };
    }>({
      type: "AI_REQUEST",
      payload: {
        prompt,
        maxOutputTokens: QUIZ_AI_MAX_OUTPUT,
        jsonObjectResponse: true,
      },
    });

    const ms = Math.round(performance.now() - t0);

    if (!response || typeof response !== "object") {
      throw new Error("Extension background returned no AI response object.");
    }

    const envelope = response as {
      type?: string;
      payload?: { text?: string; provider?: string; error?: string };
    };

    if (envelope.type === "AI_ERROR") {
      logger.error("quizSolver", "AI error from service worker", {
        ms,
        attempt,
        error: envelope.payload?.error,
      });
      throw new Error(envelope.payload?.error ?? "AI error");
    }

    if (envelope.type !== "AI_RESPONSE") {
      throw new Error(
        `Unexpected extension message type after AI call: ${String(envelope.type)}`
      );
    }

    if (!envelope.payload || typeof envelope.payload !== "object") {
      throw new Error("AI_RESPONSE missing payload from background.");
    }

    const raw = envelope.payload.text ?? "";
    lastRaw = raw;
    lastProvider = envelope.payload.provider ?? "";

    logger.log("quizSolver", "AI response ← raw model output", {
      ms,
      attempt,
      provider: lastProvider,
      responseChars: raw.length,
      raw,
    });

    const slice = sliceFirstJSONObject(raw);
    if (!slice) {
      lastParseErr = new Error("No JSON object in reply");
      logger.warn("quizSolver", "Quiz AI reply had no `{` slice", {
        attempt,
        provider: lastProvider,
      });
      continue;
    }

    try {
      const parsed = JSON.parse(slice) as AIQuizResponse;
      if (!Array.isArray(parsed.answers)) {
        lastParseErr = new Error("Missing answers array");
        continue;
      }
      logger.log("quizSolver", "AI response ← parsed answers", {
        provider: lastProvider,
        answers: parsed.answers,
      });
      return normalizeQuizAnswers(parsed.answers, questions);
    } catch (err) {
      lastParseErr = err;
      logger.warn("quizSolver", "Quiz JSON parse failed — may retry", {
        attempt,
        provider: lastProvider,
        slicePreview: slice.slice(0, 200),
        err,
      });
    }
  }

  const hint = lastRaw
    ? ` Last reply (${lastProvider}): "${lastRaw.slice(0, 160).replace(/\s+/g, " ")}"`
    : "";

  throw new Error(
    `Quiz AI returned unusable JSON after 2 tries.${hint} (${lastParseErr instanceof Error ? lastParseErr.message : String(lastParseErr)})`
  );
}

// ─── Filler ───────────────────────────────────────────────────────────────────

async function fillAnswers(
  questions: QuizQuestion[],
  answers: AIQuizResponse["answers"],
  settings: Settings
): Promise<void> {
  const blocks = findBlocks();

  if (blocks.length !== questions.length) {
    logger.warn("quizSolver", "fillAnswers: block count mismatch (re-run findBlocks)", {
      questionCount: questions.length,
      blockCount: blocks.length,
      blockLabels: blocks.map((b, i) => ({ i, label: blockDebugLabel(b) })),
    });
  }

  logger.log("quizSolver", "fillAnswers → applying to DOM", {
    pairs: questions.map((q, i) => ({
      i,
      type: q.type,
      answer: answers[i],
      block: blocks[i] ? blockDebugLabel(blocks[i]!) : "(missing)",
    })),
  });

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const block = blocks[i];
    if (!block) continue;
    const answer = answers[i];

    await pause(settings.delayMs / 4);

    if (q.type === "multiple-choice") {
      const idx = typeof answer === "number" ? answer : 0;
      const radios = listChoicesInBlock(block, "radio");
      const target = radios[idx];
      if (target) {
        target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
        target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
        target.click();
        target.dispatchEvent(new Event("change", { bubbles: true }));
      }
    } else if (q.type === "checkbox") {
      const indices: number[] = Array.isArray(answer)
        ? (answer as number[])
        : [typeof answer === "number" ? answer : 0];
      const checkboxes = listChoicesInBlock(block, "checkbox");
      indices.forEach((idx) => {
        if (checkboxes[idx] && !checkboxes[idx].checked) {
          checkboxes[idx].dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
          checkboxes[idx].dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
          checkboxes[idx].click();
          checkboxes[idx].dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
    } else if (q.type === "text") {
      const textAnswer = String(answer);
      const input = block.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        'input[type="text"], textarea'
      );
      if (input) setReactInput(input, textAnswer);
    }
  }
}

// ─── Honor code + submit ──────────────────────────────────────────────────────

async function submitQuiz(): Promise<void> {
  window.scrollTo(0, document.body.scrollHeight);
  await pause(1000);

  const submitTexts = ["submit", "submit quiz", "submit exam", "submit assignment"];

  const findSubmitBtn = (): HTMLElement | null =>
    document.querySelector<HTMLElement>('[data-testid="submit-button"]') ??
    Array.from(
      document.querySelectorAll<HTMLElement>('button, a[role="button"], div[role="button"]')
    ).find((b) => submitTexts.includes((b.textContent?.trim() ?? "").toLowerCase())) ??
    null;

  let btn = findSubmitBtn();
  if (!btn) {
    window.scrollTo(0, document.body.scrollHeight);
    await pause(1000);
    btn = findSubmitBtn();
  }
  if (!btn) return;

  // Wait for React to enable the button (up to 3 s)
  for (let i = 0; i < 15; i++) {
    if (btn.getAttribute("aria-disabled") !== "true" && !(btn as HTMLButtonElement).disabled) break;
    await pause(200);
  }

  btn.click();
  await pause(300);
  btn.click();
  await pause(1000);

  // Handle "Ready to submit?" confirmation modal
  const modalBtn = await waitForCourseraSubmitConfirmation(5000);
  if (modalBtn) {
    modalBtn.click();
    await pause(300);
    modalBtn.click();
  }
}

function findQuizNextPage(): HTMLElement | null {
  const nextSelectors = [
    '[data-testid="next-question"]',
    'button[aria-label="Next question"]',
  ];
  for (const sel of nextSelectors) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el) return el;
  }
  return null;
}

