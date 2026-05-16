/** Shared Coursera URL helpers for popup + background queue orchestration */

/**
 * Returns true ONLY when the tab is on the full assignments listing page
 * (/home/assignments). We intentionally do NOT match /home/week/N or other
 * /home sub-pages — those only show one week at a time and would cause the
 * Get Degree scrape to run with an incomplete item list, then immediately
 * navigate to item[0] without ever visiting the full assignments page.
 */
export function isCourseHomePage(url?: string): boolean {
  return /coursera\.org\/learn\/[^/]+\/home\/assignments/.test(url ?? "");
}

/** Extract /learn/{slug}/home/assignments from any coursera.org/learn/{slug}/… URL */
export function buildCourseHomeUrl(url?: string): string | null {
  const match = (url ?? "").match(/coursera\.org\/learn\/([^/?#]+)/);
  if (!match) return null;
  return `https://www.coursera.org/learn/${match[1]}/home/assignments`;
}

/** True when the browser tab URL matches the queued item (cover, attempt, or sub-routes). */
export function tabUrlMatchesQueueItem(
  tabUrl: string | undefined,
  itemUrl: string
): boolean {
  if (!tabUrl) return false;
  try {
    const tabPath = new URL(tabUrl).pathname.replace(/\/$/, "");
    const itemPath = new URL(itemUrl).pathname.replace(/\/$/, "");
    if (tabPath === itemPath) return true;
    if (tabPath.startsWith(`${itemPath}/`)) return true;
    return false;
  } catch {
    return false;
  }
}
