import { ItemType, Settings, SkillType } from "../../shared/types";
import * as logger from "../../shared/logger";
import {
  inferItemTypeFromPathname,
  inferSkillHintFromDOM,
} from "../detector";
import { clickStartLaunchIfPresent } from "../utils/dom";
import { runVideoSkipper } from "./videoSkipper";
import { runReadingSkipper } from "./readingSkipper";
import { runQuizSolver } from "./quizSolver";
import { runAssignmentWriter } from "./assignmentWriter";
import { runFormFiller } from "./formFiller";

export type StatusCallback = (msg: string) => void;

/** Map from ItemType to the corresponding SkillType */
export const ITEM_TYPE_TO_SKILL: Partial<Record<ItemType, SkillType>> = {
  video: "videoSkipper",
  reading: "readingSkipper",
  quiz: "quizSolver",
  assignment: "assignmentWriter",
  form: "formFiller",
};

/**
 * Run a specific skill module.
 */
export async function runSkill(
  skill: SkillType,
  settings: Settings,
  onStatus: StatusCallback
): Promise<void> {
  logger.log("skill", `runSkill: ${skill} start`);
  switch (skill) {
    case "videoSkipper":
      return runVideoSkipper(settings, onStatus);
    case "readingSkipper":
      return runReadingSkipper(settings, onStatus);
    case "quizSolver":
      return runQuizSolver(settings, onStatus);
    case "assignmentWriter":
      return runAssignmentWriter(settings, onStatus);
    case "formFiller":
      return runFormFiller(settings, onStatus);
  }
}

/**
 * Run the best skill for the current page's item type.
 * Falls back to "unknown" → tries formFiller as a best-effort.
 */
export async function runAutoSkill(
  itemType: ItemType,
  settings: Settings,
  onStatus: StatusCallback
): Promise<void> {
  const skill = ITEM_TYPE_TO_SKILL[itemType];
  logger.log("skill", "runAutoSkill", { itemType, mappedSkill: skill ?? "(none)" });

  async function pause(ms: number): Promise<void> {
    await new Promise<void>((r) => setTimeout(r, ms));
  }

  if (!skill) {
    onStatus(`Page type "${itemType}" — looking for Start / Resume / Launch…`);
    logger.log("skill", "runAutoSkill: unclear path, trying Start/Resume/Launch");
    const settle = Math.max(900, settings.delayMs + 500);
    const clicked = await clickStartLaunchIfPresent(settle);
    if (clicked) {
      logger.log("skill", "runAutoSkill: Start/Resume/Launch clicked");
      onStatus("Activity opened — detecting type…");
      await pause(Math.max(350, Math.floor(settings.delayMs / 2)));
    }

    let nextSkill: SkillType | null = inferSkillHintFromDOM();
    if (!nextSkill) {
      const pathType = inferItemTypeFromPathname(window.location.pathname);
      nextSkill = ITEM_TYPE_TO_SKILL[pathType] ?? null;
    }

    if (nextSkill && settings.skills[nextSkill]) {
      logger.log("skill", "runAutoSkill inferred", nextSkill);
      return runSkill(nextSkill, settings, onStatus);
    }

    if (nextSkill && !settings.skills[nextSkill]) {
      onStatus(
        `Detected ${nextSkill} but it is disabled in settings — enable it or run manually.`
      );
      return;
    }

    onStatus("No quiz/assignment UI found — trying form filler…");
    return runFormFiller(settings, onStatus);
  }

  if (!settings.skills[skill]) {
    onStatus(`Skill "${skill}" is disabled in settings.`);
    return;
  }

  return runSkill(skill, settings, onStatus);
}
