/**
 * Plugin / Widget Skipper — marks ungraded labs, notebooks, and widgets as complete.
 *
 * Strategy (mirrors TobiX's pageBridge approach):
 * 1. Extract course slug + item ID from the URL
 * 2. GET the current widget progress state
 * 3. PUT progressState: "Completed" to mark it done
 * 4. Falls back to looking for a "Mark as complete" button in the DOM
 */

import { Settings } from "../../shared/types";
import {
  getCourseSlug,
  getItemId,
  getUserId,
  callCourseraApi,
} from "../utils/courseraApi";
import * as logger from "../../shared/logger";

export async function runPluginSkipper(
  _settings: Settings,
  onStatus: (msg: string) => void
): Promise<void> {
  onStatus("Marking plugin/widget as complete…");

  const slug = getCourseSlug();
  const itemId = getItemId();
  const userId = await getUserId();

  if (slug && itemId && userId) {
    try {
      // Encode the composite key the same way Coursera does
      const encodedKey = encodeURIComponent(`${userId}~${itemId}`);
      const progressUrl = `https://www.coursera.org/api/onDemandWidgetProgress.v1/${encodedKey}`;

      onStatus("Fetching current widget progress…");
      const getRes = await callCourseraApi("GET", progressUrl);

      if (getRes.ok || getRes.status === 404) {
        onStatus("Marking widget as completed…");
        const putRes = await callCourseraApi("PUT", progressUrl, {
          progressState: "Completed",
        });
        if (putRes.ok || putRes.status === 200 || putRes.status === 204) {
          logger.log("pluginSkipper", "widget marked complete via API", {
            status: putRes.status,
          });
          onStatus("Done — plugin/widget marked complete.");
          return;
        }
        logger.warn(
          "pluginSkipper",
          `PUT returned ${putRes.status} — trying DOM fallback`
        );
      } else {
        logger.warn(
          "pluginSkipper",
          `GET widget progress returned ${getRes.status} — trying DOM fallback`
        );
      }
    } catch (err) {
      logger.warn(
        "pluginSkipper",
        "API path failed — trying DOM fallback",
        err instanceof Error ? err.message : String(err)
      );
    }
  } else {
    logger.warn("pluginSkipper", "Missing slug/itemId/userId — trying DOM fallback", {
      slug,
      itemId,
      userId,
    });
  }

  // ─── DOM fallback ─────────────────────────────────────────────────────────
  onStatus("Trying DOM approach…");

  const clicked = await tryDomComplete();
  if (clicked) {
    onStatus("Done — plugin marked complete via DOM.");
  } else {
    onStatus(
      "Could not mark plugin complete automatically. It may already be done or require manual interaction."
    );
  }
}

async function tryDomComplete(): Promise<boolean> {
  const selectors = [
    '[data-testid="mark-as-complete"]',
    'button[data-e2e="mark-complete"]',
    'button[aria-label*="Mark as complete"]',
    'button[aria-label*="mark as complete"]',
    'button[aria-label*="Mark Complete"]',
  ];

  for (const sel of selectors) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el) {
      el.click();
      await delay(500);
      return true;
    }
  }

  // Text-based fallback
  const buttons = Array.from(document.querySelectorAll<HTMLElement>("button"));
  const match = buttons.find(
    (b) =>
      !b.hasAttribute("disabled") &&
      (b.textContent?.toLowerCase().includes("mark as complete") ||
        b.textContent?.toLowerCase().includes("mark complete") ||
        b.textContent?.toLowerCase().includes("complete lab") ||
        b.textContent?.toLowerCase().includes("submit"))
  );
  if (match) {
    match.click();
    await delay(500);
    return true;
  }

  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
