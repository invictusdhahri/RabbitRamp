import { Settings } from "../../shared/types";
import { waitForElement } from "../utils/dom";

export async function runVideoSkipper(
  settings: Settings,
  onStatus: (msg: string) => void
): Promise<void> {
  onStatus("Looking for video player…");

  const video = await waitForElement<HTMLVideoElement>("video", 5000);
  if (!video) {
    onStatus("No video found on this page.");
    return;
  }

  onStatus("Skipping video…");

  // Wait for metadata so duration is known
  await new Promise<void>((resolve) => {
    if (video.readyState >= 1) {
      resolve();
    } else {
      video.addEventListener("loadedmetadata", () => resolve(), { once: true });
    }
  });

  // Jump to near-end
  video.currentTime = Math.max(0, video.duration - 0.5);
  video.dispatchEvent(new Event("timeupdate", { bubbles: true }));

  // Wait a moment for Coursera's tracker to register
  await delay(settings.delayMs);

  // Fire ended event to trigger completion callbacks
  video.dispatchEvent(new Event("ended", { bubbles: true }));

  onStatus("Done.");
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
