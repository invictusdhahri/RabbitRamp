import { CourseContext, ItemType, SkillType } from "../shared/types";
import * as logger from "../shared/logger";

/**
 * Exclude site chrome only when scanning page-wide radios/checkboxes.
 * Do not append `[aria-modal='true']`: Coursera mounts graded quiz/assignment
 * flows inside modal-like roots — that would wrongly drop every assessment input.
 */
export const SITE_CHROME_SELECTOR =
  "nav, header, footer, [role='navigation']";


/**
 * Graded items under `assignment-submission` sometimes use only multiple-choice
 * (e.g. portfolio self-assessment Yes/No), with no rich-text / large textarea.
 */

/** Radios mounted under shadow roots or same-origin activity iframes (Coursera Web Components). */
function collectRadioInputsDeep(scope: HTMLElement): HTMLInputElement[] {
  const seen = new Set<HTMLInputElement>();

  function harvest(container: HTMLElement | ShadowRoot): void {
    container
      .querySelectorAll<HTMLInputElement>('input[type="radio"]')
      .forEach((inp) => seen.add(inp));
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

/** Same traversal as radios; used by quiz solver for shadow/iframes. */
export function collectChoiceInputsDeep(scope: HTMLElement): HTMLInputElement[] {
  const seen = new Set<HTMLInputElement>();

  function harvest(container: HTMLElement | ShadowRoot): void {
    container
      .querySelectorAll<HTMLInputElement>(
        'input[type="radio"], input[type="checkbox"]'
      )
      .forEach((inp) => seen.add(inp));
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

/** Walk ancestors including shadow hosts so `closest` works across shadow boundaries. */
function composedClosest(el: HTMLElement, selector: string): Element | null {
  let cur: HTMLElement | null = el;
  while (cur) {
    try {
      if (cur.matches?.(selector)) return cur;
    } catch {
      /* invalid selector safeguard */
    }
    if (cur.parentElement) cur = cur.parentElement;
    else {
      const root = cur.getRootNode();
      cur = root instanceof ShadowRoot ? (root.host as HTMLElement) : null;
    }
  }
  return null;
}

/** Activity radios excluding chrome; includes shadow/iframes. */
function filteredActivityRadios(scope: HTMLElement): HTMLInputElement[] {
  return collectRadioInputsDeep(scope).filter(
    (inp) =>
      !inp.closest(SITE_CHROME_SELECTOR)
  );
}

function countDistinctRadioGroups(scope: HTMLElement): number {
  const names = new Set<string>();
  for (const inp of collectRadioInputsDeep(scope)) {
    if (!inp.name || inp.disabled) continue;
    if (inp.closest(SITE_CHROME_SELECTOR)) {
      continue;
    }
    names.add(inp.name);
  }
  return names.size;
}

function hasCourseraEssaySurface(scope: HTMLElement): boolean {
  if (scope.querySelector('[data-slate-editor="true"][contenteditable="true"]')) {
    return true;
  }
  for (const ta of scope.querySelectorAll<HTMLTextAreaElement>("textarea")) {
    if (ta.disabled || ta.readOnly) continue;
    const cs = window.getComputedStyle(ta);
    if (cs.display === "none" || Number(cs.opacity) < 0.02) continue;
    const r = ta.getBoundingClientRect();
    if (r.height >= 36 && r.width >= 100) return true;
  }
  for (const ce of scope.querySelectorAll<HTMLElement>('[contenteditable="true"]')) {
    if (ce.closest('[role="toolbar"]')) continue;
    const r = ce.getBoundingClientRect();
    if (r.height >= 80 && r.width >= 200) return true;
  }
  return false;
}

/**
 * True when the submission page is actually a choice-based assessment (quiz UI),
 * so the extension should not wait for a writing area.
 */
export function assignmentSubmissionLooksLikeChoiceQuiz(): boolean {
  const p = window.location.pathname.toLowerCase();
  if (!p.includes("assignment-submission")) return false;

  const scope =
    document.querySelector("main") ??
    document.querySelector<HTMLElement>(".rc-FormPartsWidget") ??
    document.body;

  if (hasCourseraEssaySurface(scope)) return false;

  const activityRadios = filteredActivityRadios(scope);
  const groups = countDistinctRadioGroups(scope);

  const hasPartSubmissionRadio = activityRadios.some((inp) =>
    composedClosest(
      inp,
      '[data-testid="part-Submission"], .rc-FormPartsWidget'
    )
  );

  const mentionsSelfAssessment =
    /\bself-assessment\b/i.test((scope.textContent ?? "").slice(0, 24_000));

  if (groups >= 2) {
    if (hasPartSubmissionRadio && (mentionsSelfAssessment || groups >= 3)) return true;
    if (groups >= 4) return true;
    if (mentionsSelfAssessment) return true;
  }

  /* Portfolio-style flows: radios only appear under shadow / custom DOM; often few named groups. */
  if (
    p.includes("/attempt") &&
    activityRadios.length >= 6 &&
    (mentionsSelfAssessment || activityRadios.length >= 10 || hasPartSubmissionRadio)
  ) {
    return true;
  }

  /* Portfolio self-assessment often uses opaque component trees until quiz solver probes. */
  if (
    p.includes("/attempt") &&
    /\bportfolio-activity\b/.test(p) &&
    !hasCourseraEssaySurface(scope)
  ) {
    return true;
  }

  return false;
}

export function inferItemTypeFromPathname(pathname: string): ItemType {
  const p = pathname.toLowerCase();
  if (p.includes("/lecture/")) return "video";
  if (p.includes("/supplement/")) return "reading";
  if (p.includes("/quiz/") || p.includes("/exam/")) return "quiz";

  // Coursera reuses `/assignment-submission/.../` for BOTH timed graded challenges
  // (MCQ/timer) AND written reflections — disambiguate from URL slug fragments.
  if (p.includes("assignment-submission")) {
    const hay = pathname.toLowerCase().replace(/-/g, " ");
    if (
      /\b(challenge|checkpoint|timed|exam|quiz|assessment)\b/i.test(hay)
    ) {
      return "quiz";
    }
    if (
      /\b(reflection|journal|essay|written|survey)\b/i.test(hay)
    ) {
      return "assignment";
    }
    return "assignment";
  }
  if (
    p.includes("staffgraded") ||
    p.includes("gradedteammate") ||
    p.includes("graded-peer") ||
    p.includes("/peer-review/")
  ) {
    return "quiz";
  }
  if (
    (p.includes("/peer/") && !p.includes("peer-review")) ||
    /\/assignment(s)?(\/|$)/i.test(p) ||
    /(\/|^)graded-assignment(\/|$)/i.test(p) ||
    p.includes("/programming/")
  ) {
    return "assignment";
  }
  if (p.includes("/discussionprompt/") || p.includes("/forum/")) return "form";
  return "unknown";
}

/**
 * Decide which autopilot skill matches the rendered activity (after any Start splash).
 */
export function inferSkillHintFromDOM(): SkillType | null {
  if (assignmentSubmissionLooksLikeChoiceQuiz()) return "quizSolver";

  const hasQuizInputs = document.querySelector(
    '[data-testid^="part-Submission"] input[type="radio"], [data-testid^="part-Submission"] input[type="checkbox"], .rc-FormPartsWidget input[type="radio"], .rc-FormPartsWidget input[type="checkbox"]'
  );

  const quizMarked = document.querySelector(
    '[data-testid^="prompt"], .rc-QuestionForm, .c-questionnaire-question, .rc-QuestionnaireQuestion'
  );

  // Reflection + short-answer items: part-Submission with textarea but no choice inputs
  const partSub = document.querySelector<HTMLElement>(
    '[data-testid="part-Submission"]'
  );
  if (
    partSub &&
    !partSub.querySelector(
      'input[type="radio"], input[type="checkbox"]'
    ) &&
    partSub.querySelector(
      'textarea, [contenteditable="true"], [role="textbox"], .DraftEditor-root'
    )
  ) {
    return "assignmentWriter";
  }

  const assignmentLike =
    document.querySelector(
      '[data-testid="peer-review-submission"], .rc-SubmitAssignment, form[data-e2e="assignment-submit"], [data-testid="wysiwyg-editor"], [data-testid="rich-text-editor"]'
    ) ?? document.querySelector(
      ".rc-AssignmentYourWork textarea, .assignment-body textarea"
    );

  if (quizMarked || hasQuizInputs) return "quizSolver";
  if (assignmentLike) return "assignmentWriter";
  return null;
}

function detectItemType(pathname: string): ItemType {
  return inferItemTypeFromPathname(pathname);
}

function detectCourseName(): string {
  // Try data-testid first
  const nameEl = document.querySelector<HTMLElement>(
    '[data-testid="course-name"], [data-e2e="course-name"]'
  );
  if (nameEl?.textContent?.trim()) return nameEl.textContent.trim();

  // Try the breadcrumb nav
  const breadcrumbs = document.querySelectorAll<HTMLElement>(
    "nav[aria-label] a, .rc-Breadcrumb a"
  );
  if (breadcrumbs.length > 0) {
    const texts = Array.from(breadcrumbs)
      .map((el) => el.textContent?.trim())
      .filter(Boolean);
    if (texts.length) return texts[0]!;
  }

  // Fallback: parse <title>
  const title = document.title;
  // Coursera titles often look like: "Quiz | Week 3 | Course Name | Coursera"
  const parts = title.split("|").map((s) => s.trim());
  if (parts.length >= 3) return parts[parts.length - 2];
  return title.replace("| Coursera", "").trim();
}

function detectWeekLabel(): string {
  const weekEl = document.querySelector<HTMLElement>(
    '[data-testid="week-name"], .rc-WeekView h3, [aria-label*="Week"]'
  );
  if (weekEl?.textContent?.trim()) return weekEl.textContent.trim();

  const title = document.title;
  const parts = title.split("|").map((s) => s.trim());
  if (parts.length >= 3) return parts[parts.length - 3] ?? "";
  return "";
}

function detectItemTitle(): string {
  const h1 = document.querySelector<HTMLElement>(
    "h1, [data-testid='item-title'], .rc-ItemPage h1"
  );
  if (h1?.textContent?.trim()) return h1.textContent.trim();

  const title = document.title;
  const parts = title.split("|").map((s) => s.trim());
  return parts[0] ?? "";
}

export function buildCourseContext(): CourseContext {
  return {
    courseName: detectCourseName(),
    weekLabel: detectWeekLabel(),
    itemTitle: detectItemTitle(),
    itemType: detectItemType(window.location.pathname),
    url: window.location.href,
  };
}

type ContextChangeCallback = (ctx: CourseContext) => void;

export function watchCourseContext(onChange: ContextChangeCallback): () => void {
  let last = "";

  const emit = () => {
    const ctx = buildCourseContext();
    const key = ctx.url + ctx.courseName;
    if (key !== last) {
      last = key;
      logger.log("detector", "course context updated", {
        itemType: ctx.itemType,
        itemTitle: ctx.itemTitle.slice(0, 80),
        weekLabel: ctx.weekLabel,
        path: tryPath(ctx.url),
      });
      onChange(ctx);
    }
  };

  function tryPath(url: string): string {
    try {
      return new URL(url).pathname;
    } catch {
      return url.slice(0, 120);
    }
  }

  // Initial emit
  emit();

  // SPA navigation via history API
  const origPush = history.pushState.bind(history);
  const origReplace = history.replaceState.bind(history);

  history.pushState = (...args) => {
    origPush(...args);
    setTimeout(emit, 300);
  };
  history.replaceState = (...args) => {
    origReplace(...args);
    setTimeout(emit, 300);
  };

  window.addEventListener("popstate", () => setTimeout(emit, 300));

  // DOM observer for title/course name changes
  const observer = new MutationObserver(() => {
    emit();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: false,
    attributes: false,
  });

  return () => {
    observer.disconnect();
    history.pushState = origPush;
    history.replaceState = origReplace;
  };
}
