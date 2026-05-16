/**
 * Discussion Skipper — auto-posts a reply to a Coursera discussion prompt.
 *
 * Strategy (mirrors TobiX's pageBridge approach):
 * 1. Extract course slug + item ID from the URL
 * 2. Fetch the discussion forum thread ID from Coursera's materials API
 * 3. POST a generic academic reply to onDemandCourseForumAnswers.v1
 * 4. Falls back to a DOM click if the API path fails
 */

import { Settings } from "../../shared/types";
import {
  getCourseSlug,
  getItemId,
  getUserId,
  callCourseraApi,
} from "../utils/courseraApi";
import * as logger from "../../shared/logger";

const GENERIC_REPLY =
  "<co-content><text>Thank you for this discussion prompt. " +
  "After reviewing the material, I find the concepts presented to be both insightful and applicable " +
  "to real-world scenarios. The framework introduced encourages critical thinking and deeper " +
  "engagement with the subject matter. I look forward to reading my peers' perspectives as well.</text></co-content>";

export async function runDiscussionSkipper(
  _settings: Settings,
  onStatus: (msg: string) => void
): Promise<void> {
  onStatus("Detecting discussion prompt…");

  const slug = getCourseSlug();
  const itemId = getItemId();
  const userId = await getUserId();

  if (slug && itemId && userId) {
    try {
      onStatus("Fetching discussion thread info…");

      // Get course materials to find the forum thread ID for this item
      const materialsUrl =
        `https://www.coursera.org/api/onDemandCourseMaterials.v2/?q=slug&slug=${slug}` +
        `&includes=passableItemGroups,passableItemGroupChoices,passableLearnerMaterials,` +
        `moduleMaterials,onDemandSessions,metadataLearnerMaterials,calendarSessions` +
        `&fields=moduleIds,onDemandCourseMaterialModules.v1(name,slug,timeCommitment,` +
        `learnerMaterials,optionalLearnerMaterials,ioptional),` +
        `onDemandCourseMaterialItems.v2(name,slug,timeCommitment,content,isLocked,lockableByItem,` +
        `itemLockedReasonCode,trackId,lockedStatus,itemLockSummary)` +
        `&showLockedItems=true`;

      const materialsRes = await callCourseraApi("GET", materialsUrl);
      let forumThreadId: string | null = null;

      if (materialsRes.ok) {
        const materialsData = (await materialsRes.json()) as {
          linked?: {
            "onDemandCourseMaterialItems.v2"?: Array<{
              id?: string;
              content?: { typeName?: string; definition?: { forumQuestionId?: string } };
            }>;
          };
        };
        const items =
          materialsData?.linked?.["onDemandCourseMaterialItems.v2"] ?? [];
        const item = items.find((i) => i.id === itemId);
        forumThreadId =
          item?.content?.definition?.forumQuestionId ?? null;
      }

      if (forumThreadId) {
        onStatus("Posting discussion reply…");
        const postRes = await callCourseraApi(
          "POST",
          "https://www.coursera.org/api/onDemandCourseForumAnswers.v1/",
          {
            courseId: slug,
            questionId: forumThreadId,
            content: {
              typeName: "cml",
              definition: { dtdId: "co-content", value: GENERIC_REPLY },
            },
            isNewContent: true,
          }
        );
        if (postRes.ok || postRes.status === 201) {
          logger.log("discussionSkipper", "reply posted via API", {
            status: postRes.status,
          });
          onStatus("Done — discussion reply posted.");
          return;
        }
        logger.warn(
          "discussionSkipper",
          `POST replied ${postRes.status} — trying DOM fallback`
        );
      } else {
        logger.warn(
          "discussionSkipper",
          "No forumThreadId found — trying DOM fallback"
        );
      }
    } catch (err) {
      logger.warn(
        "discussionSkipper",
        "API path failed — trying DOM fallback",
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  // ─── DOM fallback ─────────────────────────────────────────────────────────
  onStatus("Trying DOM approach to post discussion reply…");

  const posted = await tryDomPost();
  if (posted) {
    onStatus("Done — discussion reply posted via DOM.");
  } else {
    onStatus(
      "Could not post reply automatically. Please reply manually or navigate to the discussion page."
    );
  }
}

async function tryDomPost(): Promise<boolean> {
  // Look for a textarea or reply input
  const textarea = document.querySelector<HTMLElement>(
    'textarea, [contenteditable="true"], [role="textbox"]'
  );
  if (!textarea) return false;

  textarea.focus();
  const replyText =
    "Thank you for this discussion prompt. After reviewing the material, " +
    "I find the concepts presented to be insightful and applicable to real-world scenarios.";

  if (textarea.tagName === "TEXTAREA") {
    (textarea as HTMLTextAreaElement).value = replyText;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    textarea.textContent = replyText;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  await delay(400);

  const submitBtn = Array.from(
    document.querySelectorAll<HTMLButtonElement>("button")
  ).find(
    (b) =>
      !b.disabled &&
      (b.textContent?.toLowerCase().includes("post") ||
        b.textContent?.toLowerCase().includes("submit") ||
        b.textContent?.toLowerCase().includes("reply"))
  );
  if (submitBtn) {
    submitBtn.click();
    return true;
  }
  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
