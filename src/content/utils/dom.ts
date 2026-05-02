import type { Settings } from "../../shared/types";

async function domPause(ms: number): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, ms));
}

/**
 * Coursera Honor Code / identity agreement (quiz + graded written assignments).
 * Scrolls into view first, then uses the same heuristics and events as the quiz flow.
 */
export async function acceptCourseraHonorCode(settings: Settings): Promise<void> {
  window.scrollTo(0, document.body.scrollHeight);
  await domPause(800);

  const allCheckboxes = document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  for (const box of Array.from(allCheckboxes)) {
    if (box.checked) continue;
    if (box.disabled) continue;

    const labelText = (box.closest("label")?.innerText ?? "").toLowerCase();
    const parentText = (box.parentElement?.innerText ?? "").toLowerCase();
    const nextText =
      box.nextElementSibling instanceof HTMLElement
        ? box.nextElementSibling.innerText.toLowerCase()
        : "";
    const combined = ` ${labelText} ${parentText} ${nextText} `;

    const isHonor =
      combined.includes("honor") ||
      combined.includes("understand that submitting work") ||
      combined.includes("submitting work that isn't my own") ||
      combined.includes("certify") ||
      combined.includes("agree") ||
      combined.includes("understand and agree");

    if (isHonor) {
      box.checked = true;
      ["mousedown", "mouseup", "click", "input", "change"].forEach((et) => {
        box.dispatchEvent(new MouseEvent(et, { bubbles: true, cancelable: true }));
      });
      const label = box.closest("label");
      if (label) label.click();
      await domPause(settings.delayMs / 2);
      return;
    }
  }

  const honorSelectors = [
    '[data-testid="honor-code-checkbox"]',
    'input[name*="honor"]',
    'input[aria-label*="honor" i]',
  ];
  for (const sel of honorSelectors) {
    const el = document.querySelector<HTMLInputElement>(sel);
    if (el && !el.disabled && !el.checked) {
      el.click();
      await domPause(settings.delayMs / 2);
      return;
    }
  }
}

/** "Ready to submit?" style confirmation dialogs (Coursera). */
export async function waitForCourseraSubmitConfirmation(
  maxMs = 5000
): Promise<HTMLElement | null> {
  const submitTexts = ["submit", "submit quiz", "submit exam", "submit assignment"];
  const start = Date.now();

  while (Date.now() - start < maxMs) {
    await domPause(350);

    for (const h of Array.from(document.querySelectorAll<HTMLElement>("h1,h2,h3,h4"))) {
      const txt = (h.innerText ?? "").trim().toLowerCase();
      if (txt.startsWith("ready to submit") || txt.includes("missing or invalid")) {
        for (const ancestor of [
          h.parentElement?.parentElement,
          h.parentElement?.parentElement?.parentElement,
        ]) {
          if (!ancestor) continue;
          const b = Array.from(
            ancestor.querySelectorAll<HTMLElement>(
              'button, a[role="button"], div[role="button"]'
            )
          ).find((el) => submitTexts.includes((el.textContent?.trim() ?? "").toLowerCase()));
          if (b) return b;
        }
      }
    }

    for (const sel of [
      ".cds-modal-container",
      '[class*="modal-container"]',
      ".cds-modal-backdrop",
      '[class*="modal-backdrop"]',
    ]) {
      const container = document.querySelector<HTMLElement>(sel);
      if (container) {
        const b = Array.from(
          container.querySelectorAll<HTMLElement>(
            'button, a[role="button"], div[role="button"]'
          )
        ).find((el) => submitTexts.includes((el.textContent?.trim() ?? "").toLowerCase()));
        if (b) return b;
      }
    }
  }

  return null;
}

/**
 * Wait for a CSS selector to appear in the DOM (up to timeoutMs).
 * Returns null if not found within the timeout.
 */
export function waitForElement<T extends HTMLElement = HTMLElement>(
  selector: string,
  timeoutMs = 5000
): Promise<T | null> {
  return new Promise((resolve) => {
    const el = document.querySelector<T>(selector);
    if (el) return resolve(el);

    const observer = new MutationObserver(() => {
      const found = document.querySelector<T>(selector);
      if (found) {
        observer.disconnect();
        clearTimeout(timer);
        resolve(found);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    const timer = setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeoutMs);
  });
}

/**
 * Set a value on a React-controlled input or textarea without React ignoring it.
 * Uses the native input value setter to bypass React's synthetic event system.
 */
export function setReactInput(
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string
): void {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    el.tagName === "INPUT"
      ? window.HTMLInputElement.prototype
      : window.HTMLTextAreaElement.prototype,
    "value"
  )?.set;

  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(el, value);
  } else {
    el.value = value;
  }

  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function normalizeCta(el: HTMLElement): { text: string; label: string } {
  const text =
    el.textContent?.trim().replace(/\s+/g, " ").toLowerCase() ?? "";
  const label = el.getAttribute("aria-label")?.trim().toLowerCase() ?? "";
  return { text, label };
}

export function isInteractiveDisabled(el: HTMLElement): boolean {
  if ("disabled" in el && (el as HTMLButtonElement).disabled) return true;
  if (el.hasAttribute("disabled")) return true;
  if (el.getAttribute("aria-disabled") === "true") return true;
  return false;
}

/** Covers may mount CDS buttons inside open shadow roots (same pattern as MCQ radios). */
function collectCoverPageActionButtonsDeep(scope: HTMLElement): HTMLElement[] {
  const seen = new Set<HTMLElement>();

  function harvest(container: HTMLElement | ShadowRoot): void {
    container
      .querySelectorAll<HTMLElement>('[data-testid="CoverPageActionButton"]')
      .forEach((b) => seen.add(b));
    container.querySelectorAll<Element>("*").forEach((el) => {
      if (el.shadowRoot) harvest(el.shadowRoot);
    });
  }

  harvest(scope);
  scope.querySelectorAll<HTMLIFrameElement>("iframe").forEach((frame) => {
    try {
      const body = frame.contentDocument?.body;
      if (body) harvest(body);
    } catch {
      /* cross-origin */
    }
  });

  return Array.from(seen);
}

/** Minimal composed-tree ancestor walk (Coursera may wrap Resume under shadow portals). */
function composedClosestDom(el: HTMLElement, selector: string): Element | null {
  let cur: HTMLElement | null = el;
  while (cur) {
    try {
      if (cur.matches?.(selector)) return cur;
    } catch {
      /* noop */
    }
    if (cur.parentElement) cur = cur.parentElement;
    else {
      const root = cur.getRootNode();
      cur = root instanceof ShadowRoot ? (root.host as HTMLElement) : null;
    }
  }
  return null;
}

/** True when SPA may still be mounting the Cover page (Resume / Start) after navigation. */
function courseraCoverPageStartWorthPolling(): boolean {
  if (document.querySelector('[data-testid="assignment-details"]')) return true;
  const p = typeof location !== "undefined" ? location.pathname.toLowerCase() : "";
  // Any graded submission flow — not only URLs whose slug mentions "quiz" / "exam".
  if (p.includes("assignment-submission") || p.includes("graded-assignment")) return true;
  const hay = p.replace(/-/g, " ");
  return /\b(challenge|checkpoint|timed|exam|quiz|assessment)\b/i.test(hay);
}

/**
 * CDS cover CTA (`<button data-testid="CoverPageActionButton"><span class="cds-button-label">Resume</span>…`).
 * Prefer a visible enabled control whose label reads Start / Resume / etc.
 */
function coverButtonLabelText(el: HTMLElement): string {
  const cds =
    el.querySelector<HTMLElement>(".cds-button-label")?.innerText ??
    el.querySelector<HTMLElement>('[class*="button-label"]')?.innerText;
  const raw = (cds ?? el.textContent ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
  return raw;
}

function pickCoverPageActionButton(): HTMLElement | null {
  const nodes = collectCoverPageActionButtonsDeep(document.body);
  let bestFallback: HTMLElement | null = null;
  let bestIntent: HTMLElement | null = null;
  let bestIntentScore = -1;

  for (const el of nodes) {
    if (isInteractiveDisabled(el)) continue;
    bestFallback = el;

    const labelTxt = coverButtonLabelText(el);
    const aria = el.getAttribute("aria-label")?.trim().toLowerCase() ?? "";
    const matchesIntent =
      matchesStartLaunchIntent(labelTxt, aria) ||
      /^resume\b/.test(labelTxt) ||
      /^start\b/.test(labelTxt) ||
      /^begin\b/.test(labelTxt);

    let score = 0;
    if (matchesIntent) score += 2;
    /* Prefer Assignment details bar Resume over coach / ancillary CTAs */
    if (composedClosestDom(el, '[data-testid="assignment-details"]')) score += 3;
    if (
      typeof (el as HTMLButtonElement).className === "string" &&
      /cds-button-primary/i.test(String((el as HTMLButtonElement).className))
    ) {
      score += 1;
    }
    if (isLikelyVisible(el)) score += 1;

    if (matchesIntent && score > bestIntentScore) {
      bestIntentScore = score;
      bestIntent = el;
    }
  }

  if (bestIntent) return bestIntent;
  if (bestFallback && !isInteractiveDisabled(bestFallback)) return bestFallback;

  return null;
}

/** CDS / React often need scroll-into-view plus a fuller event sequence before navigation fires. */
function activateCourseraCoverCta(btn: HTMLElement): void {
  try {
    btn.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
  } catch {
    btn.scrollIntoView(true);
  }
  (btn as HTMLButtonElement).focus?.();

  const label = btn.querySelector<HTMLElement>(".cds-button-label");
  const opts = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    buttons: 1,
    clientX: 4,
    clientY: 4,
  };

  label?.dispatchEvent(
    new MouseEvent("pointerdown", opts as MouseEventInit)
  );
  btn.dispatchEvent(new MouseEvent("pointerdown", opts as MouseEventInit));
  btn.dispatchEvent(new MouseEvent("mousedown", opts as MouseEventInit));
  btn.dispatchEvent(new MouseEvent("mouseup", opts as MouseEventInit));
  btn.dispatchEvent(new MouseEvent("pointerup", opts as MouseEventInit));

  btn.click();

  label?.dispatchEvent(new MouseEvent("click", opts as MouseEventInit));
}

/** Coursera splash / gated activities: prominent Start / Launch / Resume / Attempt CTAs */
function matchesStartLaunchIntent(text: string, label: string): boolean {
  const hay = `${text} ${label}`;
  const exact = new Set([
    "start",
    "begin",
    "launch",
    "launch app",
    "resume",
  ]);
  if (exact.has(text) || exact.has(label)) return true;
  // In-progress attempts: same UI slot as Start, label may be longer than one word.
  if (/^resume(\s|$)/.test(text) || /^resume(\s|$)/.test(label)) return true;
  return (
    hay.includes("start quiz") ||
    hay.includes("start assignment") ||
    hay.includes("attempt quiz") ||
    hay.includes("launch assignment") ||
    hay.includes("begin assignment") ||
    hay.includes("resume assignment") ||
    hay.includes("resume quiz") ||
    hay.includes("resume attempt")
  );
}

/**
 * Click Coursera's primary assignment/quiz CTA: Start, Launch, Attempt, or Resume (in-progress).
 * Returns true if something was clicked. Waits afterward so embedded content / SPA can settle.
 */
export async function clickStartLaunchIfPresent(
  settleMs = 1400
): Promise<boolean> {
  const clickCoverAndSettle = async (btn: HTMLElement) => {
    activateCourseraCoverCta(btn);
    await new Promise<void>((r) => setTimeout(r, settleMs));
  };

  let coverBtn = pickCoverPageActionButton();
  if (coverBtn) {
    await clickCoverAndSettle(coverBtn);
    return true;
  }

  if (courseraCoverPageStartWorthPolling()) {
    const deadline = Date.now() + 18_000;
    while (Date.now() < deadline) {
      await new Promise<void>((r) => setTimeout(r, 300));
      coverBtn = pickCoverPageActionButton();
      if (coverBtn) {
        await clickCoverAndSettle(coverBtn);
        return true;
      }
    }
  }

  const primarySelectors = [
    'button[data-testid="CoverPageActionButton"]:not(:disabled)',
    '[data-testid="CoverPageActionButton"]',
    '[data-testid="start-quiz-button"]',
    '[data-testid="start-assignment-button"]',
    '[data-testid="start-attempt-button"]',
    '[data-testid="resume-quiz-button"]',
    '[data-testid="resume-assignment-button"]',
    '[data-testid="resume-attempt-button"]',
    'button[data-e2e="start-attempt"]',
    'a[data-e2e="start-attempt"]',
    'button[data-e2e="resume-attempt"]',
    'a[data-e2e="resume-attempt"]',
  ];

  for (const sel of primarySelectors) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el && !isInteractiveDisabled(el)) {
      const tid = el.getAttribute("data-testid");
      if (tid === "CoverPageActionButton") {
        await clickCoverAndSettle(el);
      } else {
        el.click();
        await new Promise<void>((r) => setTimeout(r, settleMs));
      }
      return true;
    }
  }

  const roots: ParentNode[] = [];
  for (const sel of [
    '[data-testid="assignment-details"]',
    ".rc-AttemptLaunch",
    ".rc-QuizLaunch",
    '[data-testid="course-item-content"]',
    "main",
  ]) {
    const r = document.querySelector(sel);
    if (r) roots.push(r);
  }
  if (roots.length === 0) roots.push(document.body);

  const seen = new WeakSet<HTMLElement>();

  for (const root of roots) {
    const candidates = root.querySelectorAll<HTMLElement>(
      'button, a[href], [role="button"]'
    );
    for (const el of candidates) {
      if (seen.has(el)) continue;
      seen.add(el);
      if (isInteractiveDisabled(el)) continue;
      const { text, label } = normalizeCta(el);
      if (!text && !label) continue;
      if (!matchesStartLaunchIntent(text, label)) continue;
      // Coursera sometimes stuffs timer/copy into the same node as "Resume" → long textContent.
      const primaryPrefix = /^(resume|start|begin|launch)\b/;
      if (text.length > 96 && !primaryPrefix.test(text)) continue;
      el.click();
      await new Promise<void>((r) => setTimeout(r, settleMs));
      return true;
    }
  }

  /* Last resort: deep buttons exist but scorer missed labels (SPA hydration lag). */
  const deepRemain = collectCoverPageActionButtonsDeep(document.body).filter(
    (b) => !isInteractiveDisabled(b)
  );
  for (const btn of deepRemain) {
    if (composedClosestDom(btn, '[data-testid="assignment-details"]')) {
      await clickCoverAndSettle(btn);
      return true;
    }
  }

  return false;
}

/** Visible-ish element (modals hidden off-screen shouldn't count). */
function isLikelyVisible(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  return (
    r.width > 12 &&
    r.height > 8 &&
    r.bottom > -100 &&
    r.top < globalThis.innerHeight + 200 &&
    Number(window.getComputedStyle(el).opacity) > 0.05
  );
}

/** Coursera "Start new attempt?" / timed attempt confirmation — scoped to dialogs only. */
function dialogLooksTimedAttempt(dialog: HTMLElement): boolean {
  const t = dialog.textContent?.toLowerCase() ?? "";
  if (t.includes("start new attempt")) return true;
  if (/\b(hours?|minutes?|mins)\b/.test(t) && /\battempt\b/.test(t)) return true;
  if (t.includes("submit up to")) return true;
  return false;
}

function findContinueInModal(dialog: HTMLElement): HTMLElement | null {
  const byTestIds = dialog.querySelectorAll<HTMLElement>(
    '[data-testid="modal-primary-action"], button[data-testid*="confirm"], button[data-testid*="primary"]'
  );
  for (const el of byTestIds) {
    if (!isLikelyVisible(el) || isInteractiveDisabled(el)) continue;
    const { text } = normalizeCta(el);
    if (/^continue\b/.test(text) || /^confirm\b/.test(text)) return el;
  }

  const buttons = Array.from(
    dialog.querySelectorAll<HTMLElement>("button[type='submit'], button")
  ).filter(isLikelyVisible);

  let continueBtn: HTMLElement | null = null;

  for (const b of buttons) {
    if (isInteractiveDisabled(b)) continue;
    const { text, label } = normalizeCta(b);
    const trimmed = text.trim();

    if (/^continue\b/.test(trimmed) || label.startsWith("continue"))
      continueBtn = b;
  }

  if (continueBtn) return continueBtn;

  const enabled = buttons.filter((b) => !isInteractiveDisabled(b));
  if (enabled.length === 2) {
    const c = enabled.find((b) => /^continue\b/.test(normalizeCta(b).text.trim()));
    if (c) return c;
  }

  return null;
}

/**
 * Dismiss timed-attempt confirmation modals (e.g. "Start new attempt?" → Continue).
 * Only interacts with `[role="dialog"]` trees so we avoid stray page buttons.
 */
export async function dismissCourseraTimedAttemptModal(
  settleMs = 950
): Promise<boolean> {
  const roots = Array.from(
    document.querySelectorAll<HTMLElement>('[role="dialog"]')
  );

  for (const host of roots) {
    if (!dialogLooksTimedAttempt(host)) continue;

    const btn = findContinueInModal(host);
    if (!btn || !isLikelyVisible(btn)) continue;

    btn.click();
    await new Promise<void>((r) => setTimeout(r, settleMs));
    return true;
  }

  return false;
}

/** Run Start → modal Continue a few times (handles stacked transitions). */
export async function bootstrapCourseraQuizEntry(
  startSettleMs = 1200,
  modalPasses = 4
): Promise<void> {
  await clickStartLaunchIfPresent(startSettleMs);
  for (let i = 0; i < modalPasses; i++) {
    const hit = await dismissCourseraTimedAttemptModal(1000);
    if (!hit) break;
    await new Promise<void>((r) => setTimeout(r, 250));
  }
}

/**
 * Find and click the "Next" or "Continue" navigation button.
 * Returns true if a button was found and clicked.
 */
export function clickNext(): boolean {
  const nextSelectors = [
    '[data-testid="next-button"]',
    '[data-testid="continue-button"]',
    'button[data-e2e="next"]',
    'button[aria-label="Next"]',
    'button[aria-label="Continue"]',
    ".rc-NavigationBar button:last-child",
  ];

  for (const sel of nextSelectors) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el && !el.hasAttribute("disabled")) {
      el.click();
      return true;
    }
  }

  // Text-based fallback
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
  const next = buttons.find((b) => {
    const txt = b.textContent?.trim().toLowerCase() ?? "";
    return (
      (txt === "next" || txt === "continue" || txt === "next item") &&
      !b.disabled
    );
  });

  if (next) {
    next.click();
    return true;
  }

  return false;
}

/** Simulate a realistic click with mouse events */
export function simulateClick(el: HTMLElement): void {
  ["mouseover", "mousedown", "mouseup", "click"].forEach((eventType) => {
    el.dispatchEvent(
      new MouseEvent(eventType, { bubbles: true, cancelable: true })
    );
  });
}
