import type { CourseItem } from "../shared/types";
import type { Message } from "../shared/messages";
import * as logger from "../shared/logger";
import {
  buildCourseHomeUrl,
  isCourseHomePage,
  tabUrlMatchesQueueItem,
} from "../shared/courseraUrls";

const STORAGE_KEY = "coursCheatQueueV1";

/** Serializable queue state (service worker may restart). */
interface PersistedQueue {
  tabId: number;
  items: CourseItem[];
  queueIdx: number;
  pendingQueueSkillRunIdx: number;
  sendGen: number;
  queueRunning: boolean;
  getDegreePending: boolean;
  queuedRunTotal: number;
  getDegreePhase: null | "navigating" | "scraping" | "running";
}

let state: PersistedQueue | null = null;
let scheduleTimer: ReturnType<typeof setTimeout> | null = null;
let hydrated = false;
let hydrateLoadPromise: Promise<void> | null = null;

function logQueue(msg: string) {
  logger.log("queue", msg);
  try {
    chrome.runtime.sendMessage({
      type: "QUEUE_LOG",
      payload: { message: msg },
    } satisfies Message);
  } catch {
    /* no listeners */
  }
}

async function persist() {
  if (!state) {
    await chrome.storage.session.remove(STORAGE_KEY);
    broadcastProgress();
    return;
  }
  await chrome.storage.session.set({ [STORAGE_KEY]: state });
  broadcastProgress();
}

async function hydrate(): Promise<void> {
  if (hydrated) return;
  if (!hydrateLoadPromise) {
    hydrateLoadPromise = chrome.storage.session
      .get(STORAGE_KEY)
      .then((data) => {
        state = (data[STORAGE_KEY] as PersistedQueue | undefined) ?? null;
        hydrated = true;
      });
  }
  await hydrateLoadPromise;
}

function broadcastProgress() {
  try {
    if (!state) {
      chrome.runtime.sendMessage({
        type: "QUEUE_PROGRESS",
        payload: {
          index: 0,
          total: 0,
          running: false,
          getDegreePhase: null,
        },
      } satisfies Message);
      return;
    }
    const running = state.queueRunning || state.getDegreePending;
    const idx = state.queueIdx;
    chrome.runtime.sendMessage({
      type: "QUEUE_PROGRESS",
      payload: {
        index: idx < 0 ? 0 : idx,
        total: state.queuedRunTotal,
        running,
        getDegreePhase: state.getDegreePhase,
      },
    } satisfies Message);
  } catch {
    /* no listeners */
  }
}

function clearScheduleTimer() {
  if (scheduleTimer != null) {
    clearTimeout(scheduleTimer);
    scheduleTimer = null;
  }
}

/** Public snapshot for popup */
export function getQueueStateForPopup(): {
  running: boolean;
  queueIndex: number | null;
  queuedRunTotal: number;
  getDegreePhase: null | "navigating" | "scraping" | "running";
} {
  if (!state) {
    return {
      running: false,
      queueIndex: null,
      queuedRunTotal: 0,
      getDegreePhase: null,
    };
  }
  const running = state.queueRunning || state.getDegreePending;
  return {
    running,
    queueIndex:
      state.queueRunning && state.queueIdx >= 0 ? state.queueIdx : null,
    queuedRunTotal: state.queuedRunTotal,
    getDegreePhase: state.getDegreePhase,
  };
}

async function advanceQueue() {
  await hydrate();
  if (!state) return;

  const next = state.queueIdx + 1;
  if (next >= state.items.length) {
    state.queueRunning = false;
    state.queueIdx = -1;
    state.pendingQueueSkillRunIdx = -999;
    state.getDegreePhase = null;
    state.getDegreePending = false;
    logQueue(`Queue complete — processed ${state.items.length} items.`);

    const tabId = state.tabId;
    const firstItem = state.items[0];
    const assignmentsUrl =
      firstItem?.url != null ? buildCourseHomeUrl(firstItem.url) : null;
    if (assignmentsUrl) {
      logQueue("Returning to course assignments…");
      chrome.tabs.update(tabId, { url: assignmentsUrl });
    }
    state = null;
    await persist();
    return;
  }

  state.queueIdx = next;
  state.pendingQueueSkillRunIdx = next;
  const item = state.items[next];
  logQueue(`[${next + 1}/${state.items.length}] ${item.title}`);

  clearScheduleTimer();
  chrome.tabs.update(state.tabId, { url: item.url });
  await persist();
}

function trySendRunAllSkills(tabId: number, gen: number, attempt: number) {
  if (!state) return;
  if (state.sendGen !== gen) return;
  if (!state.queueRunning || state.queueIdx < 0) return;

  chrome.tabs.sendMessage(
    tabId,
    { type: "RUN_ALL_SKILLS" } satisfies Message,
    (res: { ok: boolean; error?: string } | undefined) => {
      if (!state || state.sendGen !== gen) return;

      if (chrome.runtime.lastError) {
        if (attempt < 3) {
          const delayMs = 1200 * (attempt + 1);
          logQueue(
            `Content script not ready, retrying in ${delayMs / 1000}s… (${attempt + 1}/3)`
          );
          setTimeout(() => trySendRunAllSkills(tabId, gen, attempt + 1), delayMs);
        } else {
          logQueue("Could not reach content script — skipping item.");
          void advanceQueue();
        }
      } else if (!res?.ok) {
        logQueue(`Skill error: ${res?.error ?? "unknown"}`);
      }
    }
  );
}

function scheduleRunAllAfterLoad(tabId: number) {
  clearScheduleTimer();
  scheduleTimer = setTimeout(() => {
    scheduleTimer = null;
    if (!state) return;

    if (state.queueRunning && state.queueIdx >= 0) {
      chrome.tabs.get(tabId, (t) => {
        if (chrome.runtime.lastError || !state) return;
        const currentUrl = t?.url;
        const qItem = state.items[state.queueIdx];
        if (!qItem || !tabUrlMatchesQueueItem(currentUrl, qItem.url)) {
          return;
        }

        if (state.pendingQueueSkillRunIdx !== state.queueIdx) {
          return;
        }

        state.pendingQueueSkillRunIdx = -999;
        const gen = ++state.sendGen;
        void persist();
        trySendRunAllSkills(tabId, gen, 0);
      });
    }
  }, 800);
}

async function onTabUpdated(
  tabId: number,
  changeInfo: chrome.tabs.TabChangeInfo,
  tab: chrome.tabs.Tab
) {
  await hydrate();
  if (!state) return;
  if (tabId !== state.tabId) return;
  if (changeInfo.status !== "complete") return;

  clearScheduleTimer();

  // Get Degree: first home load after arm → scrape + queue
  if (state.getDegreePending && isCourseHomePage(tab.url)) {
    state.getDegreePending = false;
    state.getDegreePhase = "scraping";
    logQueue("Scanning for graded items…");
    await persist();

    chrome.tabs.sendMessage(
      tabId,
      { type: "SCRAPE_COURSE_ITEMS" } satisfies Message,
      async (res: CourseItem[] | undefined) => {
        await hydrate();
        if (!state) return;
        if (chrome.runtime.lastError || !res || res.length === 0) {
          logQueue("No graded items found. Try expanding all weeks.");
          state.getDegreePhase = null;
          state.queueRunning = false;
          state = null;
          await persist();
          return;
        }
        const pending = res.filter((i) => !i.completed);
        const skipped = res.length - pending.length;
        if (skipped > 0) {
          logQueue(`Skipping ${skipped} already-completed item(s).`);
        }
        if (pending.length === 0) {
          logQueue("Nothing to run — all items are already completed.");
          state.getDegreePhase = null;
          state.queueRunning = false;
          state = null;
          await persist();
          return;
        }
        state.items = pending;
        state.queuedRunTotal = pending.length;
        state.queueIdx = -1;
        state.queueRunning = true;
        state.getDegreePhase = "running";
        state.pendingQueueSkillRunIdx = -999;
        logQueue(
          `Starting queue — ${pending.length} item${pending.length !== 1 ? "s" : ""}…`
        );
        await persist();
        await advanceQueue();
      }
    );
    return;
  }

  if (state.queueRunning && state.queueIdx >= 0) {
    scheduleRunAllAfterLoad(tabId);
  }

  await persist();
}

async function recoverIfTabAlreadyReady() {
  await hydrate();
  if (!state || !state.queueRunning || state.queueIdx < 0) return;
  chrome.tabs.get(state.tabId, (t) => {
    if (chrome.runtime.lastError || !state) return;
    const qItem = state.items[state.queueIdx];
    if (!qItem?.url || !tabUrlMatchesQueueItem(t.url, qItem.url)) return;
    scheduleRunAllAfterLoad(state.tabId);
  });
}

export async function initQueueRunner() {
  await hydrate();

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    void onTabUpdated(tabId, changeInfo, tab);
  });

  await recoverIfTabAlreadyReady();
}

export async function handleQueueSkillStatus(
  message: Message,
  sender: chrome.runtime.MessageSender
): Promise<void> {
  if (message.type !== "SKILL_STATUS") return;
  await hydrate();
  if (!state?.queueRunning || state.queueIdx < 0) return;
  const tabId = sender.tab?.id;
  if (tabId !== state.tabId) return;

  const st = message.payload.status;
  if (st !== "done" && st !== "error") return;

  void advanceQueue();
}

export async function messageQueueStart(payload: {
  tabId: number;
  items: CourseItem[];
}): Promise<boolean> {
  const pending = payload.items.filter((i) => !i.completed);
  const skipped = payload.items.length - pending.length;
  await hydrate();

  if (pending.length === 0) {
    if (skipped > 0) {
      try {
        chrome.runtime.sendMessage({
          type: "QUEUE_LOG",
          payload: { message: `Skipping ${skipped} already-completed item(s).` },
        } satisfies Message);
      } catch {
        /* no listeners */
      }
    }
    try {
      chrome.runtime.sendMessage({
        type: "QUEUE_LOG",
        payload: {
          message: "Nothing to run — all items are already completed.",
        },
      } satisfies Message);
    } catch {
      /* no listeners */
    }
    return false;
  }

  if (skipped > 0) {
    logQueue(`Skipping ${skipped} already-completed item(s).`);
  }

  state = {
    tabId: payload.tabId,
    items: pending,
    queueIdx: -1,
    pendingQueueSkillRunIdx: -999,
    sendGen: 0,
    queueRunning: true,
    getDegreePending: false,
    queuedRunTotal: pending.length,
    getDegreePhase: "running",
  };
  logQueue(
    `Starting queue — ${pending.length} item${pending.length !== 1 ? "s" : ""}…`
  );
  await persist();
  await advanceQueue();
  return true;
}

export async function messageGetDegreeArm(tabId: number): Promise<void> {
  await hydrate();
  state = {
    tabId,
    items: [],
    queueIdx: -1,
    pendingQueueSkillRunIdx: -999,
    sendGen: 0,
    queueRunning: false,
    getDegreePending: true,
    queuedRunTotal: 0,
    getDegreePhase: "navigating",
  };
  await persist();
}
