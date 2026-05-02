import { buildCourseContext, watchCourseContext } from "./detector";
import { runAutoSkill, runSkill, ITEM_TYPE_TO_SKILL } from "./skills/masterRunner";
import { scrapeGradedItems } from "./skills/courseScraper";
import { getSettings } from "../shared/storage";
import { Message } from "../shared/messages";
import { SkillType } from "../shared/types";
import { mountStatusBar, updateStatusBar } from "./overlay/mount";
import { clickNext } from "./utils/dom";
import * as logger from "../shared/logger";

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

let currentContext = buildCourseContext();

logger.log("content", "content script injected", {
  pathname: typeof location !== "undefined" ? location.pathname : "",
});

// Mount the floating status bar
mountStatusBar();
updateStatusBar({ context: currentContext, status: "idle", message: "Ready" });

// Watch for SPA navigation changes
watchCourseContext((ctx) => {
  currentContext = ctx;
  updateStatusBar({ context: ctx, status: "idle", message: "Ready" });
  // Broadcast to popup
  chrome.runtime.sendMessage({
    type: "COURSE_CONTEXT_UPDATED",
    payload: ctx,
  } satisfies Message);
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener(
  (message: Message, _sender, sendResponse) => {
    switch (message.type) {
      case "GET_COURSE_CONTEXT":
        logger.log("content", "GET_COURSE_CONTEXT", {
          itemType: currentContext.itemType,
          pathname: typeof location !== "undefined" ? location.pathname : "",
        });
        sendResponse(currentContext);
        return false;

      case "RUN_SKILL": {
        const skill = message.payload.skill as SkillType;
        logger.log("content", "RUN_SKILL", { skill, itemType: currentContext.itemType });
        updateStatusBar({
          context: currentContext,
          status: "running",
          message: `Running ${skill}…`,
        });

        (async () => {
          try {
            const settings = await getSettings();
            await runSkill(skill, settings, (msg) => {
              updateStatusBar({
                context: currentContext,
                status: "running",
                message: msg,
              });
              chrome.runtime.sendMessage({
                type: "SKILL_STATUS",
                payload: { skill, status: "running", message: msg },
              } satisfies Message);
            });

            updateStatusBar({
              context: currentContext,
              status: "idle",
              message: "Done",
            });
            chrome.runtime.sendMessage({
              type: "SKILL_STATUS",
              payload: { skill, status: "done", message: "Done" },
            } satisfies Message);

            // Respond BEFORE navigating — sendResponse must reach the popup
            // before this content script context is destroyed by navigation.
            logger.log("content", "RUN_SKILL complete", { skill, autoNext: settings.autoNext });
            sendResponse({ ok: true });

            if (settings.autoNext) {
              await delay(600);
              logger.log("content", "auto-next clickNext()");
              clickNext();
            }
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error("content", "RUN_SKILL failed", skill, msg);
            updateStatusBar({
              context: currentContext,
              status: "idle",
              message: `Error: ${msg}`,
            });
            chrome.runtime.sendMessage({
              type: "SKILL_STATUS",
              payload: { skill, status: "error", message: msg },
            } satisfies Message);
            sendResponse({ ok: false, error: msg });
          }
        })();

        return true;
      }

      case "SCRAPE_COURSE_ITEMS": {
        sendResponse(scrapeGradedItems());
        return false;
      }

      case "RUN_ALL_SKILLS": {
        const ctx = currentContext;
        logger.log("content", "RUN_ALL_SKILLS", { itemType: ctx.itemType });
        updateStatusBar({
          context: ctx,
          status: "running",
          message: "Running all skills…",
        });
        // Infer the skill name for status reporting; fall back to "videoSkipper" as placeholder.
        const autoSkillName: SkillType =
          ITEM_TYPE_TO_SKILL[ctx.itemType] ?? "videoSkipper";
        getSettings()
          .then((settings) =>
            runAutoSkill(ctx.itemType, settings, (msg) => {
              updateStatusBar({ context: ctx, status: "running", message: msg });
              chrome.runtime.sendMessage({
                type: "SKILL_STATUS",
                payload: { skill: autoSkillName, status: "running", message: msg },
              } satisfies Message);
            })
          )
          .then(() => {
            logger.log("content", "RUN_ALL_SKILLS complete");
            updateStatusBar({ context: ctx, status: "idle", message: "All done!" });
            chrome.runtime.sendMessage({
              type: "SKILL_STATUS",
              payload: { skill: autoSkillName, status: "done", message: "Done" },
            } satisfies Message);
            sendResponse({ ok: true });
          })
          .catch((err: unknown) => {
            const errMsg = err instanceof Error ? err.message : String(err);
            logger.error("content", "RUN_ALL_SKILLS failed", errMsg);
            updateStatusBar({ context: ctx, status: "idle", message: `Error: ${errMsg}` });
            chrome.runtime.sendMessage({
              type: "SKILL_STATUS",
              payload: { skill: autoSkillName, status: "error", message: errMsg },
            } satisfies Message);
            sendResponse({ ok: false, error: errMsg });
          });
        return true;
      }

      default:
        return false;
    }
  }
);
