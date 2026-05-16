import { Settings } from "../../shared/types";
import { getCourseSlug, getItemId, getUserId, callCourseraApi } from "../utils/courseraApi";
import * as logger from "../../shared/logger";

export async function runReadingSkipper(
  settings: Settings,
  onStatus: (msg: string) => void
): Promise<void> {
  onStatus("Marking reading as complete…");

  const slug = getCourseSlug();
  const itemId = getItemId();
  const userId = await getUserId();

  if (slug && itemId && userId) {
    try {
      onStatus("Calling Coursera API to mark reading complete…");
      const res = await callCourseraApi(
        "POST",
        "https://www.coursera.org/api/onDemandSupplementCompletions.v1",
        { id: `${userId}~${itemId}` }
      );
      if (res.ok || res.status === 204 || res.status === 201) {
        logger.log("readingSkipper", "API mark-complete succeeded", { status: res.status });
        onStatus("Done — reading marked complete via API.");
        return;
      }
      logger.warn(
        "readingSkipper",
        `API call returned ${res.status} — falling back to DOM approach`
      );
    } catch (err) {
      logger.warn(
        "readingSkipper",
        "API call failed — falling back to DOM approach",
        err instanceof Error ? err.message : String(err)
      );
    }
  } else {
    logger.warn("readingSkipper", "Missing slug/itemId/userId — falling back to DOM approach", {
      slug,
      itemId,
      userId,
    });
  }

  // ─── DOM fallback ─────────────────────────────────────────────────────────
  onStatus("Scrolling through reading…");

  await smoothScrollToBottom();
  await delay(settings.delayMs);

  const markComplete = findMarkComplete();
  if (markComplete) {
    onStatus("Marking as complete…");
    markComplete.click();
    await delay(500);
  }

  onStatus("Done.");
}

async function smoothScrollToBottom(): Promise<void> {
  const totalHeight = document.body.scrollHeight;
  const step = Math.max(200, Math.floor(totalHeight / 20));
  let current = 0;

  while (current < totalHeight) {
    current = Math.min(current + step, totalHeight);
    window.scrollTo({ top: current, behavior: "smooth" });
    window.dispatchEvent(new Event("scroll"));
    await delay(60);
  }
}

function findMarkComplete(): HTMLElement | null {
  const selectors = [
    '[data-testid="mark-as-complete"]',
    'button[data-e2e="mark-complete"]',
    'button[aria-label*="Mark as complete"]',
    'button[aria-label*="mark as complete"]',
  ];
  for (const sel of selectors) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el) return el;
  }
  const buttons = Array.from(document.querySelectorAll<HTMLElement>("button"));
  return (
    buttons.find((b) =>
      b.textContent?.toLowerCase().includes("mark as complete")
    ) ?? null
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
