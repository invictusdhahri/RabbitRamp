import { Settings } from "../../shared/types";
import { sendToBackground } from "../../shared/messages";
import { sliceFirstJSONObject } from "../../background/ai/router";
import { assignmentSubmissionLooksLikeChoiceQuiz } from "../detector";
import { runQuizSolver } from "./quizSolver";
import {
  acceptCourseraHonorCode,
  clickStartLaunchIfPresent,
  dismissCourseraTimedAttemptModal,
  isInteractiveDisabled,
  setReactInput,
  waitForCourseraSubmitConfirmation,
} from "../utils/dom";

export async function runAssignmentWriter(
  settings: Settings,
  onStatus: (msg: string) => void
): Promise<void> {
  onStatus("Opening assignment…");

  // If we're not yet on the attempt page, click Start/Resume/Continue and wait for the
  // SPA router to push the /attempt URL before we start looking for the editor.
  const onAttemptPage = () =>
    window.location.pathname.includes("/attempt");

  if (!onAttemptPage()) {
    await clickStartLaunchIfPresent(1400);
    // Dismiss any "new attempt?" modal that Coursera shows.
    for (let i = 0; i < 5; i++) {
      const hit = await dismissCourseraTimedAttemptModal(800);
      if (!hit) break;
    }
    // Wait up to 10 s for the SPA to navigate to /attempt.
    const deadline = Date.now() + 10_000;
    while (!onAttemptPage() && Date.now() < deadline) {
      await pause(300);
    }
    // Give the React tree a moment to mount the editor after navigation.
    await pause(600);
  }

  const root = document.body;
  const surface = await waitForEssaySurfaceOrQuizUI(onStatus, root);
  if (surface === "quiz") {
    onStatus("Quiz-style prompts detected (includes self-assessment) — switching to Solve Quiz.");
    return runQuizSolver(settings, onStatus);
  }

  const instructions = extractInstructions();
  if (!instructions.trim()) {
    throw new Error("Could not read assignment instructions from the page.");
  }

  onStatus("Asking AI to write assignment…");
  const content = await generateAssignment(instructions);
  if (!content.trim()) {
    throw new Error("AI returned empty assignment text.");
  }

  onStatus("Filling assignment text…");
  await injectAssignmentContent(root, content, settings);

  await acceptCourseraHonorCode(settings);
  await pause(settings.delayMs + 400);

  if (settings.autoSubmit) {
    onStatus("Submitting assignment…");
    await submitCourseraAssignment(settings);
    await pause(settings.delayMs);
  } else {
    onStatus(
      "Text and honor checkbox updated. Turn on Auto Submit in settings to press Submit automatically."
    );
  }
}

function extractInstructions(): string {
  // Try narrow, assignment-specific containers first (most precise).
  const narrowSelectors = [
    '[data-testid="assignment-instructions"]',
    '[data-testid="assignment-prompt"]',
    ".rc-AssignmentBody",
    ".assignment-body",
    ".assignment-instructions",
    "article",
  ];

  for (const sel of narrowSelectors) {
    const el = document.querySelector<HTMLElement>(sel);
    const t = el?.textContent?.trim() ?? "";
    if (t.length > 80) return t.slice(0, 3000);
  }

  // Fallback: extract numbered lists and paragraphs inside main that look like
  // assignment prompts, avoiding nav / toolbar / footer noise.
  const main = document.querySelector("main");
  if (main) {
    // Collect only text-bearing elements (p, li, h1-h4) that are NOT inside
    // toolbars, headers, or footers.
    const chunks: string[] = [];
    for (const el of main.querySelectorAll<HTMLElement>("h1,h2,h3,h4,p,li")) {
      if (el.closest("nav, header, footer, [role='toolbar'], [role='navigation']")) continue;
      const t = el.textContent?.trim() ?? "";
      if (t.length > 8) chunks.push(t);
    }
    const joined = chunks.join("\n");
    if (joined.length > 80) return joined.slice(0, 3000);
  }

  return document.title.slice(0, 200);
}

async function generateAssignment(instructions: string): Promise<string> {
  const prompt = `You are writing a high-quality assignment submission for an online course.
Write a complete, well-structured, original response based on the following instructions.
Return a JSON object with a single key "content" containing your submission text (3-5 sentences unless instructed otherwise).
Do NOT include any markdown or code fences.

Instructions:
${instructions}`;

  const response = await sendToBackground<{
    type: string;
    payload: { text?: string; error?: string };
  }>({
    type: "AI_REQUEST",
    payload: { prompt, jsonObjectResponse: true },
  });

  if (response.type === "AI_ERROR") {
    throw new Error(response.payload.error ?? "AI error");
  }

  const raw = response.payload.text ?? "";
  const slice = sliceFirstJSONObject(raw);
  try {
    if (slice) {
      const parsed = JSON.parse(slice) as { content: string };
      if (typeof parsed.content === "string" && parsed.content.trim()) {
        return parsed.content;
      }
    }
    return raw;
  } catch {
    return raw;
  }
}

function writableAreaPx(el: HTMLElement | null | undefined): number {
  if (!el) return 0;
  const cs = window.getComputedStyle(el);
  if (cs.display === "none") return 0;
  const r = el.getBoundingClientRect();
  if (r.height < 4 || r.width < 16) return 0;
  if (cs.visibility === "hidden" || Number(cs.opacity) < 0.02) return 0;
  return r.width * r.height;
}

function isLikelyFormattingToolbarAncestor(el: Element): boolean {
  // Only check ANCESTORS — el.closest() also matches the element itself, which
  // would incorrectly reject the Slate editor whose aria-label contains "format".
  return !!el.parentElement?.closest(
    '[role="toolbar"], [class*="toolbar" i]'
  );
}

function pickBestTargets(root: HTMLElement): {
  textarea: HTMLTextAreaElement | null;
  editable: HTMLElement | null;
} {
  // Slate-specific: always prefer the Slate editor if present (it has
  // data-slate-editor="true" and contenteditable="true").
  const slateEditor = root.querySelector<HTMLElement>(
    '[data-slate-editor="true"][contenteditable="true"]'
  );

  let bestTa: HTMLTextAreaElement | null = null;
  let taAr = 0;
  root.querySelectorAll<HTMLTextAreaElement>("textarea").forEach((ta) => {
    if (ta.disabled || ta.readOnly) return;
    const ar = writableAreaPx(ta);
    if (ar > taAr) {
      taAr = ar;
      bestTa = ta;
    }
  });

  let bestCe: HTMLElement | null = slateEditor;
  let ceAr = slateEditor ? Math.max(writableAreaPx(slateEditor), 1) : 0;

  if (!slateEditor) {
    root.querySelectorAll<HTMLElement>('[contenteditable="true"]').forEach((ce) => {
      if (isLikelyFormattingToolbarAncestor(ce)) return;
      const ar = writableAreaPx(ce);
      if (ar > ceAr) {
        ceAr = ar;
        bestCe = ce;
      }
    });
  }

  if (!bestCe && taAr === 0) {
    const ph = root.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder*="Enter" i], textarea[placeholder*="Type" i], textarea[placeholder*="Write" i]'
    );
    if (ph && !ph.disabled && !ph.readOnly) bestTa = ph;
  }

  return { textarea: bestTa, editable: bestCe };
}

/** Resolve after the SPA shows either an essay surface or quiz-style choices. */
async function waitForEssaySurfaceOrQuizUI(
  onStatus: (msg: string) => void,
  root: HTMLElement
): Promise<"essay" | "quiz"> {
  const deadline = Date.now() + 18_000;
  let tick = 0;
  while (Date.now() < deadline) {
    // Some graded "assignments" are only MCQ self-assessment (no writing area).
    if (assignmentSubmissionLooksLikeChoiceQuiz()) return "quiz";

    const slateEl = root.querySelector<HTMLElement>(
      '[data-slate-editor="true"][contenteditable="true"]'
    );
    if (slateEl) return "essay";

    const { textarea, editable } = pickBestTargets(root);
    if (writableAreaPx(editable) > 320 || writableAreaPx(textarea) > 320) {
      return "essay";
    }

    tick++;
    onStatus(`Waiting for editor (${tick})…`);
    await pause(450);
  }

  if (assignmentSubmissionLooksLikeChoiceQuiz()) return "quiz";

  throw new Error(
    "Coursera's writing area did not load in time — refresh the tab and retry."
  );
}

function normalizePlain(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

function textLooksPresent(
  root: HTMLElement,
  editable: HTMLElement | null,
  textarea: HTMLTextAreaElement | null,
  payload: string
): boolean {
  const needleFull = normalizePlain(payload).slice(0, 120);
  if (needleFull.length < 24) return true;
  const needle = needleFull.slice(0, 56);

  // For Slate editors, text lives in [data-slate-string] leaf spans.
  const slateText = [...root.querySelectorAll<HTMLElement>("[data-slate-string]")]
    .map((n) => n.textContent ?? "")
    .join("");
  if (slateText.length >= 40 && normalizePlain(slateText).includes(needle.slice(0, 32)))
    return true;

  const ce = editable?.innerText?.trim() ?? "";
  if (ce.length >= 40 && normalizePlain(ce).includes(needle.slice(0, 32))) return true;

  const tv = textarea?.value?.trim() ?? "";
  if (tv.length >= 40 && normalizePlain(tv).includes(needle.slice(0, 32))) return true;

  for (const tx of root.querySelectorAll<HTMLTextAreaElement>("textarea")) {
    const v = tx.value.trim();
    if (v.length >= 40 && normalizePlain(v).includes(needle.slice(0, 32))) return true;
  }

  return false;
}

function syncMirrorTextareas(
  root: HTMLElement,
  primaryTa: HTMLTextAreaElement | null,
  content: string
): void {
  for (const tx of root.querySelectorAll<HTMLTextAreaElement>("textarea")) {
    if (tx === primaryTa) continue;
    if (tx.disabled || tx.readOnly) continue;
    if (writableAreaPx(tx) > 12000) continue;
    try {
      setReactInput(tx, content);
    } catch {
      tx.value = content;
      tx.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
}

async function injectAssignmentContent(
  root: HTMLElement,
  content: string,
  settings: Settings
): Promise<void> {
  const { textarea: ta, editable: ce } = pickBestTargets(root);
  const taA = writableAreaPx(ta);
  const ceA = writableAreaPx(ce);

  const preferDraft =
    ceA >= Math.max(taA * 0.5, 480) ||
    (ceA >= 280 && (!ta || ta.value.trim().length === 0));

  if (preferDraft && ce) {
    ce.focus();
    await pause(60);
    execInsertIntoContentEditable(ce, content);
    await pause(settings.delayMs / 2);
    syncMirrorTextareas(root, ta, content);

    if (!textLooksPresent(root, ce, ta, content)) {
      setReactInputOnAnyTextarea(root, content, ta);
      await pause(220);
    }
    if (!textLooksPresent(root, ce, ta, content)) {
      throw new Error(
        "Could not insert text into Coursera's editor — try reloading the page."
      );
    }
    return;
  }

  if (ta) {
    setReactInput(ta, content);
    ta.dispatchEvent(new Event("blur", { bubbles: true }));
    ta.dispatchEvent(
      new InputEvent("input", { bubbles: true, composed: true, data: content })
    );
    await pause(settings.delayMs / 2);
    syncMirrorTextareas(root, ta, content);

    if (!textLooksPresent(root, ce, ta, content)) {
      throw new Error("Text did not stick in the assignment field.");
    }
    return;
  }

  throw new Error("No assignment text field was found inside the submission area.");
}

function setReactInputOnAnyTextarea(
  root: HTMLElement,
  content: string,
  skip: HTMLTextAreaElement | null
): void {
  for (const tx of root.querySelectorAll<HTMLTextAreaElement>("textarea")) {
    if (tx === skip) continue;
    if (tx.disabled || tx.readOnly) continue;
    setReactInput(tx, content);
  }
}

function execInsertIntoContentEditable(el: HTMLElement, text: string): void {
  el.focus();
  const sel = window.getSelection?.();
  if (sel && document.createRange) {
    sel.removeAllRanges();
    const r = document.createRange();
    r.selectNodeContents(el);
    sel.addRange(r);
  }

  // For Slate.js editors (data-slate-editor): fire a beforeinput event first
  // (Slate intercepts this to update its own model), then execCommand as fallback.
  const isSlate = el.hasAttribute("data-slate-editor");
  if (isSlate) {
    el.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        composed: true,
        cancelable: true,
        data: text,
        inputType: "insertText",
      })
    );
  }

  document.execCommand("insertText", false, text);

  el.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      composed: true,
      data: text,
      inputType: "insertText",
    })
  );
}

async function submitCourseraAssignment(settings: Settings): Promise<void> {
  window.scrollTo(0, document.body.scrollHeight);
  await pause(1000);

  const testIds = [
    '[data-testid="submit-button"]',
    '[data-testid="submit_assignment"]',
    '[data-testid="submit-assignment"]',
    'button[data-e2e="submit-assignment"]',
  ];

  for (let attempt = 0; attempt < 48; attempt++) {
    await acceptCourseraHonorCode(settings);
    await pause(280);

    let btn: HTMLButtonElement | null = null;
    for (const sel of testIds) {
      const el = document.querySelector<HTMLButtonElement>(sel);
      if (el && writableAreaPx(el) > 4) {
        btn = el;
        break;
      }
    }

    if (!btn) {
      btn =
        [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => {
          if (isInteractiveDisabled(b)) return false;
          const t = b.innerText.trim().replace(/\s+/g, " ");
          if (/draft|cancel|back|delete/i.test(t)) return false;
          return /^submit$/i.test(t) || /\bsubmit assignment\b/i.test(t);
        }) ?? null;
    }

    if (btn) {
      for (let i = 0; i < 15; i++) {
        if (!isInteractiveDisabled(btn)) break;
        await pause(200);
      }
      if (!isInteractiveDisabled(btn)) {
        btn.focus();
        btn.click();
        await pause(300);
        btn.click();
        await pause(800);
        const modalBtn = await waitForCourseraSubmitConfirmation(5000);
        if (modalBtn) {
          modalBtn.click();
          await pause(300);
          modalBtn.click();
        }
        return;
      }
    }

    await pause(320);
  }

  throw new Error(
    "Submit never became clickable — confirm the editor has text and the honor checkbox is ticked."
  );
}

function pause(ms: number): Promise<void> {
  return new Promise<void>((r) => setTimeout(r, ms));
}
