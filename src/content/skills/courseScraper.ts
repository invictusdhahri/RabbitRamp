import { CourseItem, ItemType } from "../../shared/types";
import { inferItemTypeFromPathname } from "../detector";
import * as logger from "../../shared/logger";

/**
 * Structural / navigation path segments that are NOT gradable items.
 * Any third path segment under /learn/{slug}/ that IS in this set is skipped.
 */
const STRUCTURAL_SEGMENTS = new Set([
  "home",
  "info",
  "discussions",
  "resources",
  "search",
  "assets",
  "settings",
  "certificate",
  "grades",
  "overview",
  "syllabus",
  "faq",
  "creator",
  "forum",
]);

/**
 * Returns true for any URL that looks like a navigable course item:
 *   https://www.coursera.org/learn/{slug}/{itemType}/{itemId}[/...]
 * where {itemType} is NOT a structural navigation segment.
 */
function isItemHref(href: string): boolean {
  try {
    const url = new URL(href);
    if (!url.hostname.endsWith("coursera.org")) return false;
    const parts = url.pathname.split("/").filter(Boolean);
    // /learn/{slug}/{itemType}/{itemId}  → at least 4 parts
    if (parts.length < 4) return false;
    if (parts[0] !== "learn") return false;
    const segment = parts[2].toLowerCase();
    if (STRUCTURAL_SEGMENTS.has(segment)) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Try to extract a readable title from a link and its surrounding DOM.
 */
function extractTitle(anchor: HTMLAnchorElement): string {
  // 1. Named heading inside the anchor
  const heading = anchor.querySelector(
    "h2, h3, h4, [data-testid*='title'], [data-testid*='name'], [class*='title'], [class*='name']"
  );
  if (heading?.textContent?.trim()) return heading.textContent.trim();

  // 2. aria-label on the anchor
  const aria = anchor.getAttribute("aria-label");
  if (aria?.trim()) return aria.trim();

  // 3. The anchor's own trimmed text (skip if too short or too long)
  const ownText = anchor.textContent?.trim().replace(/\s+/g, " ");
  if (ownText && ownText.length > 2 && ownText.length < 200) return ownText;

  // 4. Nearest parent row / card heading
  const row = anchor.closest(
    "[data-testid*='row'], [data-testid*='item'], [data-testid*='assignment'], " +
    ".rc-ItemRow, .rc-WeekItemRow, [class*='item-row'], [class*='ItemRow'], " +
    "tr, li"
  );
  if (row) {
    const rowHeading = row.querySelector(
      "h2, h3, h4, span[data-testid*='name'], span[data-testid*='title'], " +
      "[class*='title'], [class*='name'], td:first-child"
    );
    const txt = rowHeading?.textContent?.trim().replace(/\s+/g, " ");
    if (txt && txt.length > 2 && txt.length < 200) return txt;
  }

  // 5. Derive from URL
  try {
    const parts = new URL(anchor.href).pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1];
    return last ? last.replace(/-/g, " ") : anchor.href;
  } catch {
    return anchor.href;
  }
}

/**
 * Walk up the DOM from the anchor to find the tightest row-level container.
 * Coursera uses div[role="row"] / rc-AssignmentsTableRow on the grades page
 * and rc-WeekItemRow / li on week/module pages.
 */
function findRowContainer(anchor: HTMLAnchorElement): Element {
  return (
    anchor.closest(
      // Coursera grades page rows
      '[role="row"], [data-e2e*="row"], .rc-AssignmentsTableRow, ' +
      // Week/module outline rows
      ".rc-WeekItemRow, .rc-ItemRow, " +
      // Generic fallbacks (data-testid based Coursera components)
      "[data-testid*='assignment'], [data-testid*='item'], [data-testid*='row'], " +
      // HTML table/list primitives
      "tr, li"
    ) ??
    anchor.parentElement ??
    anchor
  );
}

/**
 * Detect whether a graded item has already been completed/passed.
 *
 * Uses two narrow signals on the correctly-isolated row element:
 *   1. Coursera's completion SVG whose <title> is exactly "Completed"
 *   2. The word "Passed" anywhere inside the row (Status column on the grades page)
 *
 * NOTE: we intentionally do NOT check for percentage values because every
 * Coursera grades-page row shows a "Weight" percentage (e.g. "25%") that
 * is unrelated to whether the item was submitted.
 */
function isItemCompleted(anchor: HTMLAnchorElement): boolean {
  const row = findRowContainer(anchor);

  // 1. The Coursera completion checkmark is an SVG whose <title> is exactly "Completed".
  for (const titleEl of row.querySelectorAll<SVGTitleElement>("svg title")) {
    if (titleEl.textContent?.trim().toLowerCase() === "completed") return true;
  }

  // 2. The word "Passed" in the row text (Status column).
  //    Safe now that findRowContainer() properly isolates one row at a time,
  //    so "Passed" from a neighbouring row can't bleed in.
  if (/\bPassed\b/.test(row.textContent ?? "")) return true;

  return false;
}

/**
 * Deduplicate items by the pathname (strip query/hash).
 */
function dedup(items: CourseItem[]): CourseItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    try {
      const key = new URL(item.url).pathname;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    } catch {
      return true;
    }
  });
}

function toAbsolute(href: string): string {
  try {
    return new URL(href, window.location.origin).href;
  } catch {
    return href;
  }
}

/**
 * Scrape all course item links visible on the current Coursera page.
 * Works on /home/assignments (grades page), /home/week/N (weekly outline),
 * and any other Coursera page that lists item links.
 */
export function scrapeGradedItems(): CourseItem[] {
  logger.log("courseScraper", "scrapeGradedItems start", { url: window.location.href });

  const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"));
  logger.log("courseScraper", `total anchors on page: ${anchors.length}`);

  const items: CourseItem[] = [];

  for (const anchor of anchors) {
    const raw = anchor.getAttribute("href") ?? "";
    const href = toAbsolute(raw);

    if (!isItemHref(href)) continue;

    let pathname: string;
    try {
      pathname = new URL(href).pathname;
    } catch {
      continue;
    }

    const itemType: ItemType = inferItemTypeFromPathname(pathname);
    const title = extractTitle(anchor);
    const completed = isItemCompleted(anchor);

    items.push({ title, url: href, itemType, completed });
  }

  const result = dedup(items);

  logger.log("courseScraper", "scrapeGradedItems done", {
    found: result.length,
    completed: result.filter((i) => i.completed).length,
    breakdown: result.reduce<Record<string, number>>((acc, i) => {
      acc[i.itemType] = (acc[i.itemType] ?? 0) + 1;
      return acc;
    }, {}),
  });

  return result;
}
