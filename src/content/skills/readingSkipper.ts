import { Settings } from "../../shared/types";

export async function runReadingSkipper(
  settings: Settings,
  onStatus: (msg: string) => void
): Promise<void> {
  onStatus("Scrolling through reading…");

  await smoothScrollToBottom();

  await delay(settings.delayMs);

  // Try "Mark as complete" button
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
  // Text search fallback
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
