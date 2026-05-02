/** Shared Coursera URL helpers for popup + background queue orchestration */

export function isCourseHomePage(url?: string): boolean {
  return /coursera\.org\/learn\/[^/]+\/home/.test(url ?? "");
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
