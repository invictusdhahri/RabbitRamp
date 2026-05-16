import { Settings } from "../../shared/types";
import { waitForElement } from "../utils/dom";
import {
  getCourseSlug,
  getItemId,
  getUserId,
  callCourseraApi,
} from "../utils/courseraApi";
import * as logger from "../../shared/logger";

export async function runVideoSkipper(
  settings: Settings,
  onStatus: (msg: string) => void
): Promise<void> {
  onStatus("Marking video as watched…");

  const slug = getCourseSlug();
  const itemId = getItemId();
  const userId = await getUserId();

  if (slug && itemId && userId) {
    try {
      onStatus("Calling Coursera API to mark video complete…");
      const url =
        `https://www.coursera.org/api/opencourse.v1/user/${userId}/course/${slug}` +
        `/item/${itemId}/lecture/videoEvents/ended?autoEnroll=false`;
      const res = await callCourseraApi("POST", url, {
        contentRequestBody: {},
      });
      if (res.ok || res.status === 204 || res.status === 200) {
        logger.log("videoSkipper", "API mark-complete succeeded", { status: res.status });
        onStatus("Done — video marked complete via API.");
        return;
      }
      logger.warn(
        "videoSkipper",
        `API call returned ${res.status} — falling back to DOM approach`
      );
    } catch (err) {
      logger.warn(
        "videoSkipper",
        "API call failed — falling back to DOM approach",
        err instanceof Error ? err.message : String(err)
      );
    }
  } else {
    logger.warn("videoSkipper", "Missing slug/itemId/userId — falling back to DOM approach", {
      slug,
      itemId,
      userId,
    });
  }

  // ─── DOM fallback ─────────────────────────────────────────────────────────
  onStatus("Looking for video player…");
  const video = await waitForElement<HTMLVideoElement>("video", 5000);
  if (!video) {
    onStatus("No video found on this page.");
    return;
  }

  onStatus("Skipping video via DOM…");

  await new Promise<void>((resolve) => {
    if (video.readyState >= 1) {
      resolve();
    } else {
      video.addEventListener("loadedmetadata", () => resolve(), { once: true });
    }
  });

  video.currentTime = Math.max(0, video.duration - 0.5);
  video.dispatchEvent(new Event("timeupdate", { bubbles: true }));

  await delay(settings.delayMs);

  video.dispatchEvent(new Event("ended", { bubbles: true }));

  onStatus("Done.");
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
