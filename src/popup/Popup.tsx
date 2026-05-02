import { useEffect, useRef, useState } from "react";
import { CourseContext, CourseItem, ItemType, Settings, SkillType } from "../shared/types";
import { DEFAULT_SETTINGS } from "../shared/types";
import { getSettings } from "../shared/storage";
import { Message } from "../shared/messages";
import * as logger from "../shared/logger";
import { buildCourseHomeUrl, isCourseHomePage } from "../shared/courseraUrls";

type QueueProgressState = {
  running: boolean;
  index: number;
  total: number;
  getDegreePhase: null | "navigating" | "scraping" | "running";
};

// ─── Skill config ──────────────────────────────────────────────────────────────

interface SkillDef {
  id: SkillType;
  label: string;
  icon: string;
  description: string;
  relevantFor: ItemType[];
}

const SKILLS: SkillDef[] = [
  {
    id: "videoSkipper",
    label: "Skip Video",
    icon: "▶",
    description: "Jump to end & mark complete",
    relevantFor: ["video"],
  },
  {
    id: "readingSkipper",
    label: "Skip Reading",
    icon: "📖",
    description: "Scroll-complete & mark done",
    relevantFor: ["reading"],
  },
  {
    id: "quizSolver",
    label: "Solve Quiz",
    icon: "🧠",
    description: "AI answers + auto-submit",
    relevantFor: ["quiz", "unknown"],
  },
  {
    id: "assignmentWriter",
    label: "Write Assignment",
    icon: "✍",
    description: "AI writes & submits",
    relevantFor: ["assignment", "unknown"],
  },
  {
    id: "formFiller",
    label: "Fill Form",
    icon: "📝",
    description: "AI fills text fields",
    relevantFor: ["form", "unknown"],
  },
];

const ITEM_ICONS: Record<ItemType, string> = {
  video: "▶",
  reading: "📖",
  quiz: "🧠",
  assignment: "✍",
  form: "📝",
  unknown: "📄",
};

const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  video: "Video",
  reading: "Reading",
  quiz: "Quiz",
  assignment: "Assignment",
  form: "Discussion",
  unknown: "Item",
};

// ─── Component ────────────────────────────────────────────────────────────────

export function Popup() {
  const [context, setContext] = useState<CourseContext | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [statusLog, setStatusLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [hasProviders, setHasProviders] = useState(false);

  // Course home — queue progress synced from background (runs with popup closed)
  const [courseItems, setCourseItems] = useState<CourseItem[]>([]);
  const [scanning, setScanning] = useState(false);
  const [queueProgress, setQueueProgress] = useState<QueueProgressState>({
    running: false,
    index: 0,
    total: 0,
    getDegreePhase: null,
  });

  const logRef = useRef<HTMLDivElement>(null);
  const runningTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeTabIdRef = useRef<number | null>(null);
  const queueBgRunningRef = useRef(false);

  const busy = running || queueProgress.running;
  const getDegreePhase = queueProgress.getDegreePhase;
  const queueUiIndex =
    queueProgress.running && queueProgress.total > 0 ? queueProgress.index : null;

  function applyQueueSnap(snap: {
    running: boolean;
    queueIndex: number | null;
    queuedRunTotal: number;
    getDegreePhase: QueueProgressState["getDegreePhase"];
  }) {
    queueBgRunningRef.current = snap.running;
    setQueueProgress({
      running: snap.running,
      index:
        snap.queueIndex != null && snap.queueIndex >= 0 ? snap.queueIndex : 0,
      total: snap.queuedRunTotal,
      getDegreePhase: snap.getDegreePhase,
    });
  }

  function startRunning() {
    setRunning(true);
    if (runningTimeoutRef.current) clearTimeout(runningTimeoutRef.current);
    runningTimeoutRef.current = setTimeout(() => {
      setRunning(false);
    }, 120_000);
  }

  function stopRunning() {
    if (runningTimeoutRef.current) {
      clearTimeout(runningTimeoutRef.current);
      runningTimeoutRef.current = null;
    }
    setRunning(false);
  }

  function fetchContext(tabId: number) {
    chrome.tabs.sendMessage(
      tabId,
      { type: "GET_COURSE_CONTEXT" } satisfies Message,
      (res: CourseContext | undefined) => {
        if (chrome.runtime.lastError) {
          logger.warn("popup", "fetchContext failed", chrome.runtime.lastError.message);
          return;
        }
        if (res) {
          setContext(res);
        }
      }
    );
  }

  function runQueue(items: CourseItem[]) {
    const pending = items.filter((i) => !i.completed);
    const skipped = items.length - pending.length;
    if (skipped > 0) addLog(`Skipping ${skipped} already-completed item(s).`);
    if (busy || pending.length === 0) {
      if (pending.length === 0) {
        addLog("Nothing to run — all items are already completed.");
      }
      return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (!tabId) {
        addLog("No active tab.");
        return;
      }
      chrome.runtime.sendMessage(
        {
          type: "QUEUE_START",
          payload: { tabId, items: pending },
        } satisfies Message,
        (res: { ok?: boolean } | undefined) => {
          if (chrome.runtime.lastError) {
            addLog(`Queue failed: ${chrome.runtime.lastError.message}`);
            stopRunning();
            return;
          }
          if (!res?.ok) {
            stopRunning();
            return;
          }
          startRunning();
        }
      );
    });
  }

  async function sendGetDegree() {
    if (busy) return;
    const homeUrl = buildCourseHomeUrl(context?.url);
    if (!homeUrl) {
      addLog("Could not detect course — navigate to a course page first.");
      return;
    }

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;
    if (!tabId) {
      addLog("No active tab.");
      return;
    }

    try {
      await new Promise<void>((resolve, reject) => {
        chrome.runtime.sendMessage(
          { type: "GET_DEGREE_ARM", payload: { tabId } } satisfies Message,
          () => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve();
            }
          }
        );
      });
    } catch (e: unknown) {
      addLog(`Get Degree failed: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    startRunning();
    setCourseItems([]);
    addLog("Navigating to assignments page…");
    chrome.tabs.update(tabId, { url: homeUrl });
  }

  function stopQueue() {
    chrome.runtime.sendMessage({ type: "QUEUE_STOP" } satisfies Message, (res) => {
      if (chrome.runtime.lastError) {
        addLog(`Stop failed: ${chrome.runtime.lastError.message}`);
        return;
      }
      const ok = res && typeof res === "object" && "ok" in res && (res as { ok?: boolean }).ok;
      if (!ok) {
        const err =
          res && typeof res === "object" && "error" in res
            ? String((res as { error?: string }).error)
            : "unknown error";
        addLog(`Stop failed: ${err}`);
        return;
      }
      stopRunning();
    });
  }

  function addLog(msg: string) {
    setStatusLog((prev) => [...prev.slice(-29), msg]);
  }

  // ─── Effects ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (queueProgress.running && runningTimeoutRef.current) {
      clearTimeout(runningTimeoutRef.current);
      runningTimeoutRef.current = null;
    }
  }, [queueProgress.running]);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "QUEUE_GET_STATE" } satisfies Message, (snap) => {
      if (chrome.runtime.lastError) return;
      if (snap && typeof snap === "object" && "running" in snap) {
        applyQueueSnap(snap as Parameters<typeof applyQueueSnap>[0]);
      }
    });
  }, []);

  useEffect(() => {
    getSettings().then((s) => {
      setSettings(s);
      setHasProviders(s.providerPriority.some((p) => s.providers[p].enabled && s.providers[p].apiKey));
    });

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (!tabId) return;
      activeTabIdRef.current = tabId;
      fetchContext(tabId);
    });

    const onTabUpdated = (
      tabId: number,
      changeInfo: chrome.tabs.TabChangeInfo,
      tab: chrome.tabs.Tab
    ) => {
      if (tabId !== activeTabIdRef.current) return;
      if (changeInfo.status !== "complete") return;

      if (!isCourseHomePage(tab.url) && !queueBgRunningRef.current) {
        setCourseItems([]);
      }

      setTimeout(() => {
        fetchContext(tabId);
      }, 800);
    };
    chrome.tabs.onUpdated.addListener(onTabUpdated);

    const listener = (message: Message) => {
      if (message.type === "QUEUE_PROGRESS") {
        queueBgRunningRef.current = message.payload.running;
        setQueueProgress({
          running: message.payload.running,
          index: message.payload.index,
          total: message.payload.total,
          getDegreePhase: message.payload.getDegreePhase ?? null,
        });
        return;
      }
      if (message.type === "QUEUE_LOG") {
        addLog(message.payload.message);
        return;
      }
      if (message.type === "COURSE_CONTEXT_UPDATED") {
        setContext(message.payload);
      }
      if (message.type === "SKILL_STATUS") {
        addLog(message.payload.message);
        if (message.payload.status === "done" || message.payload.status === "error") {
          if (!queueBgRunningRef.current) stopRunning();
        }
      }
    };
    chrome.runtime.onMessage.addListener(listener);

    return () => {
      chrome.tabs.onUpdated.removeListener(onTabUpdated);
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, []);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [statusLog]);

  // ─── Per-page actions ──────────────────────────────────────────────────────

  async function sendSkill(skill: SkillType) {
    if (busy) return;
    startRunning();
    addLog(`Running ${skill}…`);

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;
    if (!tabId) { addLog("No active tab."); stopRunning(); return; }

    chrome.tabs.sendMessage(
      tabId,
      { type: "RUN_SKILL", payload: { skill } } satisfies Message,
      (res: { ok: boolean; error?: string } | undefined) => {
        if (chrome.runtime.lastError) {
          addLog(`Error: ${chrome.runtime.lastError.message}`);
          stopRunning();
          return;
        }
        addLog(res?.ok ? "Done." : `Error: ${res?.error ?? "Unknown"}`);
        stopRunning();
      }
    );
  }

  async function sendDoEverything() {
    if (busy) return;
    startRunning();
    addLog("Running all skills for current page…");

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;
    if (!tabId) { addLog("No active tab."); stopRunning(); return; }

    chrome.tabs.sendMessage(
      tabId,
      { type: "RUN_ALL_SKILLS" } satisfies Message,
      (res: { ok: boolean; error?: string } | undefined) => {
        if (chrome.runtime.lastError) {
          addLog(`Error: ${chrome.runtime.lastError.message}`);
          stopRunning();
          return;
        }
        addLog(res?.ok ? "Done!" : `Error: ${res?.error ?? "Unknown"}`);
        stopRunning();
      }
    );
  }

  async function scanAssignments() {
    if (scanning) return;
    setScanning(true);
    setCourseItems([]);
    addLog("Scanning course for graded items…");

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;
    if (!tabId) { addLog("No active tab."); setScanning(false); return; }

    chrome.tabs.sendMessage(
      tabId,
      { type: "SCRAPE_COURSE_ITEMS" } satisfies Message,
      (res: CourseItem[] | undefined) => {
        setScanning(false);
        if (chrome.runtime.lastError) { addLog(`Scan error: ${chrome.runtime.lastError.message}`); return; }
        if (!res || res.length === 0) { addLog("No graded items found. Try expanding all weeks first."); return; }
        setCourseItems(res);
        addLog(`Found ${res.length} graded item${res.length !== 1 ? "s" : ""}.`);
      }
    );
  }

  // ─── Derived ──────────────────────────────────────────────────────────────

  const isCoursera = context?.url?.includes("coursera.org") ?? false;
  const onHomePage = isCourseHomePage(context?.url);
  const hasCourseSlug = !!buildCourseHomeUrl(context?.url);
  const getDegreeLabel =
    getDegreePhase === "navigating"
      ? "Navigating…"
      : getDegreePhase === "scraping"
        ? "Scanning…"
        : getDegreePhase === "running"
          ? queueUiIndex !== null
            ? queueProgress.total > 0
              ? `${queueUiIndex + 1} / ${queueProgress.total}`
              : `${queueUiIndex + 1} / …`
            : "Running…"
          : "🎓 GET DEGREE";

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        background: "#0f0f14",
        color: "white",
        fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
        fontSize: "13px",
        padding: "0",
        width: "340px",
      }}
    >
      {/* ── Header ── */}
      <div
        style={{
          background: "linear-gradient(135deg, #1e1b4b 0%, #0f0f14 100%)",
          borderBottom: "1px solid rgba(99,102,241,0.2)",
          padding: "14px 16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "20px" }}>⚡</span>
            <div>
              <div
                style={{
                  fontWeight: 800,
                  fontSize: "15px",
                  background: "linear-gradient(90deg, #818cf8, #c084fc)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                CoursCheat
              </div>
              <div style={{ fontSize: "10px", color: "#64748b" }}>Coursera Autopilot</div>
            </div>
          </div>
          <button
            onClick={() => chrome.runtime.openOptionsPage()}
            style={{
              background: "rgba(99,102,241,0.15)",
              border: "1px solid rgba(99,102,241,0.3)",
              borderRadius: "6px",
              color: "#a5b4fc",
              cursor: "pointer",
              fontSize: "11px",
              padding: "4px 8px",
            }}
          >
            ⚙ Settings
          </button>
        </div>
      </div>

      {/* ── Course Info ── */}
      <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        {!isCoursera ? (
          <div
            style={{
              background: "rgba(251,191,36,0.08)",
              border: "1px solid rgba(251,191,36,0.2)",
              borderRadius: "8px",
              padding: "10px 12px",
              color: "#fbbf24",
              fontSize: "12px",
            }}
          >
            ⚠ Navigate to a Coursera page to use CoursCheat.
          </div>
        ) : (
          <div
            style={{
              background: "rgba(99,102,241,0.08)",
              border: "1px solid rgba(99,102,241,0.15)",
              borderRadius: "8px",
              padding: "10px 12px",
            }}
          >
            {context?.courseName ? (
              <>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: "12px",
                    color: "#c7d2fe",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={context.courseName}
                >
                  🎓 {context.courseName}
                </div>
                {onHomePage ? (
                  <div style={{ fontSize: "11px", color: "#6366f1", marginTop: "3px" }}>
                    📋 Assignments page — scan or auto-run below
                  </div>
                ) : context.weekLabel ? (
                  <div style={{ fontSize: "11px", color: "#6366f1", marginTop: "3px" }}>
                    {context.weekLabel}
                    {context.itemType !== "unknown" && (
                      <> · {ITEM_ICONS[context.itemType]} {context.itemTitle || context.itemType}</>
                    )}
                  </div>
                ) : null}
              </>
            ) : (
              <div style={{ color: "#64748b", fontSize: "12px" }}>Detecting course…</div>
            )}
          </div>
        )}

        {!hasProviders && (
          <div
            style={{
              marginTop: "8px",
              background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.2)",
              borderRadius: "8px",
              padding: "8px 12px",
              color: "#f87171",
              fontSize: "11px",
            }}
          >
            No AI provider configured.{" "}
            <button
              onClick={() => chrome.runtime.openOptionsPage()}
              style={{
                background: "none",
                border: "none",
                color: "#f87171",
                cursor: "pointer",
                textDecoration: "underline",
                fontSize: "11px",
                padding: 0,
              }}
            >
              Add an API key →
            </button>
          </div>
        )}
      </div>

      {/* ── GET DEGREE — always visible on any Coursera course page ── */}
      {isCoursera && hasCourseSlug && (
        <div
          style={{
            padding: "12px 16px 0",
          }}
        >
          <button
            onClick={sendGetDegree}
            disabled={busy}
            title="Navigate to the assignments page, scan all graded items, and complete them all automatically"
            style={{
              width: "100%",
              background: busy && getDegreePhase
                ? "rgba(245,158,11,0.25)"
                : busy
                  ? "rgba(245,158,11,0.15)"
                  : "linear-gradient(135deg, #d97706, #f59e0b, #fbbf24)",
              border: busy && getDegreePhase ? "1px solid rgba(245,158,11,0.5)" : "none",
              borderRadius: "12px",
              color: busy && getDegreePhase ? "#fcd34d" : "#0f0f14",
              cursor: busy ? "not-allowed" : "pointer",
              fontSize: "14px",
              fontWeight: 800,
              padding: "13px",
              letterSpacing: "0.8px",
              boxShadow: busy ? "none" : "0 4px 24px rgba(245,158,11,0.45)",
              transition: "all 0.2s",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              textTransform: "uppercase",
            }}
          >
            {getDegreePhase ? (
              <>
                <Spinner color={getDegreePhase ? "#fcd34d" : "#0f0f14"} />
                {getDegreeLabel}
              </>
            ) : (
              getDegreeLabel
            )}
          </button>
          {getDegreePhase === "running" && queueProgress.total > 0 && (
            <div
              style={{
                marginTop: "6px",
                height: "3px",
                borderRadius: "3px",
                background: "rgba(255,255,255,0.08)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${Math.min(
                    100,
                    Math.round(
                      (((queueProgress.index ?? 0) + 1) / queueProgress.total) * 100
                    )
                  )}%`,
                  background: "linear-gradient(90deg, #d97706, #fbbf24)",
                  borderRadius: "3px",
                  transition: "width 0.4s",
                }}
              />
            </div>
          )}
          {queueProgress.running && (
            <button
              type="button"
              onClick={stopQueue}
              style={{
                width: "100%",
                marginTop: "10px",
                background: "rgba(239,68,68,0.12)",
                border: "1px solid rgba(239,68,68,0.35)",
                borderRadius: "8px",
                color: "#f87171",
                cursor: "pointer",
                fontSize: "12px",
                fontWeight: 600,
                padding: "8px 10px",
              }}
            >
              Stop queue
            </button>
          )}
        </div>
      )}

      {/* ── Course Home scan panel ── */}
      {isCoursera && onHomePage && (
        <CourseHomePanel
          items={courseItems}
          scanning={scanning}
          running={busy}
          queueIndex={queueUiIndex}
          getDegreeActive={getDegreePhase !== null}
          onScan={scanAssignments}
          onRunQueue={() => runQueue(courseItems)}
        />
      )}

      {/* ── Per-page skill buttons ── */}
      {isCoursera && !onHomePage && (
        <div style={{ padding: "12px 16px 16px" }}>
          <div
            style={{
              fontSize: "10px",
              color: "#475569",
              textTransform: "uppercase",
              letterSpacing: "0.8px",
              marginBottom: "7px",
              marginTop: "12px",
            }}
          >
            Current page
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "6px",
              marginBottom: "8px",
            }}
          >
            {SKILLS.map((skill) => {
              const isRelevant = context?.itemType
                ? skill.relevantFor.includes(context.itemType)
                : false;
              const isEnabled = settings.skills[skill.id];

              return (
                <button
                  key={skill.id}
                  onClick={() => sendSkill(skill.id)}
                  disabled={busy || !isEnabled}
                  title={skill.description}
                  style={{
                    background: isRelevant ? "rgba(99,102,241,0.15)" : "rgba(255,255,255,0.04)",
                    border: isRelevant
                      ? "1px solid rgba(99,102,241,0.4)"
                      : "1px solid rgba(255,255,255,0.08)",
                    borderRadius: "8px",
                    color: isRelevant ? "#a5b4fc" : "#64748b",
                    cursor: busy || !isEnabled ? "not-allowed" : "pointer",
                    fontSize: "12px",
                    fontWeight: isRelevant ? 600 : 400,
                    padding: "9px 10px",
                    textAlign: "left",
                    transition: "all 0.2s",
                    opacity: !isEnabled ? 0.4 : 1,
                  }}
                >
                  <span style={{ marginRight: "6px" }}>{skill.icon}</span>
                  {skill.label}
                </button>
              );
            })}
          </div>

          <button
            onClick={sendDoEverything}
            disabled={busy}
            style={{
              width: "100%",
              background: busy
                ? "rgba(99,102,241,0.3)"
                : "linear-gradient(135deg, #6366f1, #8b5cf6)",
              border: "none",
              borderRadius: "10px",
              color: "white",
              cursor: busy ? "not-allowed" : "pointer",
              fontSize: "13px",
              fontWeight: 700,
              padding: "11px",
              letterSpacing: "0.5px",
              boxShadow: busy ? "none" : "0 4px 20px rgba(99,102,241,0.35)",
              transition: "all 0.2s",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
            }}
          >
            {running && !queueProgress.running ? (
              <>
                <Spinner /> Running…
              </>
            ) : (
              "⚡ DO EVERYTHING"
            )}
          </button>
        </div>
      )}

      {/* ── Status Log ── */}
      {statusLog.length > 0 && (
        <div
          style={{
            borderTop: "1px solid rgba(255,255,255,0.06)",
            padding: "10px 16px 12px",
          }}
        >
          <div
            style={{
              fontSize: "10px",
              color: "#475569",
              textTransform: "uppercase",
              letterSpacing: "0.8px",
              marginBottom: "6px",
            }}
          >
            Log
          </div>
          <div
            ref={logRef}
            style={{
              maxHeight: "80px",
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: "2px",
            }}
          >
            {statusLog.map((entry, i) => (
              <div
                key={i}
                style={{
                  fontSize: "11px",
                  color: i === statusLog.length - 1 ? "#c7d2fe" : "#475569",
                  padding: "2px 0",
                }}
              >
                {entry}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── CourseHomePanel ───────────────────────────────────────────────────────────

interface CourseHomePanelProps {
  items: CourseItem[];
  scanning: boolean;
  running: boolean;
  queueIndex: number | null;
  getDegreeActive: boolean;
  onScan: () => void;
  onRunQueue: () => void;
}

function CourseHomePanel({
  items,
  scanning,
  running,
  queueIndex,
  getDegreeActive,
  onScan,
  onRunQueue,
}: CourseHomePanelProps) {
  const TYPE_COLORS: Record<ItemType, string> = {
    quiz: "rgba(99,102,241,0.25)",
    assignment: "rgba(139,92,246,0.25)",
    form: "rgba(34,211,238,0.15)",
    video: "rgba(16,185,129,0.15)",
    reading: "rgba(251,191,36,0.15)",
    unknown: "rgba(100,116,139,0.15)",
  };

  const TYPE_TEXT: Record<ItemType, string> = {
    quiz: "#a5b4fc",
    assignment: "#c084fc",
    form: "#67e8f9",
    video: "#6ee7b7",
    reading: "#fcd34d",
    unknown: "#94a3b8",
  };

  return (
    <div style={{ padding: "12px 16px 16px" }}>
      <div
        style={{
          fontSize: "10px",
          color: "#475569",
          textTransform: "uppercase",
          letterSpacing: "0.8px",
          marginBottom: "7px",
          marginTop: "4px",
        }}
      >
        Manual scan
      </div>

      <button
        onClick={onScan}
        disabled={scanning || running}
        style={{
          width: "100%",
          background: "rgba(99,102,241,0.08)",
          border: "1px solid rgba(99,102,241,0.25)",
          borderRadius: "8px",
          color: "#a5b4fc",
          cursor: scanning || running ? "not-allowed" : "pointer",
          fontSize: "12px",
          fontWeight: 600,
          padding: "8px",
          marginBottom: items.length > 0 ? "8px" : "0",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "6px",
          transition: "all 0.2s",
        }}
      >
        {scanning ? <><Spinner /> Scanning…</> : "🔍 Scan Assignments"}
      </button>

      {items.length > 0 && (
        <>
          {(() => {
            const pendingCount = items.filter((i) => !i.completed).length;
            const doneCount = items.length - pendingCount;
            return (
              <div
                style={{
                  fontSize: "10px",
                  color: "#475569",
                  textTransform: "uppercase",
                  letterSpacing: "0.8px",
                  marginBottom: "5px",
                  display: "flex",
                  gap: "8px",
                }}
              >
                <span>{items.length} item{items.length !== 1 ? "s" : ""} found</span>
                {doneCount > 0 && (
                  <span style={{ color: "#22c55e" }}>{doneCount} done</span>
                )}
              </div>
            );
          })()}
          <div
            style={{
              maxHeight: "130px",
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: "3px",
              marginBottom: "8px",
            }}
          >
            {items.map((item, i) => {
              const isCurrent = getDegreeActive && queueIndex === i;
              const isQueueDone = getDegreeActive && queueIndex !== null && i < queueIndex;
              const isAlreadyCompleted = item.completed === true;
              const faded = isQueueDone || isAlreadyCompleted;
              return (
                <div
                  key={item.url}
                  style={{
                    background: isCurrent ? "rgba(99,102,241,0.15)" : "rgba(255,255,255,0.03)",
                    border: isCurrent
                      ? "1px solid rgba(99,102,241,0.35)"
                      : isAlreadyCompleted
                      ? "1px solid rgba(34,197,94,0.2)"
                      : "1px solid rgba(255,255,255,0.05)",
                    borderRadius: "5px",
                    padding: "5px 7px",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    opacity: faded ? 0.38 : 1,
                  }}
                >
                  <span style={{ fontSize: "12px", flexShrink: 0 }}>
                    {isQueueDone || isAlreadyCompleted ? "✓" : ITEM_ICONS[item.itemType]}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      fontSize: "11px",
                      color: isCurrent ? "#e0e7ff" : "#94a3b8",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      textDecoration: isAlreadyCompleted ? "line-through" : "none",
                    }}
                    title={item.title}
                  >
                    {item.title}
                  </span>
                  {isAlreadyCompleted ? (
                    <span
                      style={{
                        fontSize: "9px",
                        fontWeight: 600,
                        padding: "2px 4px",
                        borderRadius: "3px",
                        background: "rgba(34,197,94,0.15)",
                        color: "#4ade80",
                        flexShrink: 0,
                        textTransform: "uppercase",
                        letterSpacing: "0.4px",
                      }}
                    >
                      Done
                    </span>
                  ) : (
                    <span
                      style={{
                        fontSize: "9px",
                        fontWeight: 600,
                        padding: "2px 4px",
                        borderRadius: "3px",
                        background: TYPE_COLORS[item.itemType],
                        color: TYPE_TEXT[item.itemType],
                        flexShrink: 0,
                        textTransform: "uppercase",
                        letterSpacing: "0.4px",
                      }}
                    >
                      {ITEM_TYPE_LABELS[item.itemType]}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {(() => {
            const pendingCount = items.filter((i) => !i.completed).length;
            return (
              <button
                onClick={onRunQueue}
                disabled={running || pendingCount === 0}
                style={{
                  width: "100%",
                  background:
                    running || pendingCount === 0
                      ? "rgba(99,102,241,0.3)"
                      : "linear-gradient(135deg, #6366f1, #8b5cf6)",
                  border: "none",
                  borderRadius: "8px",
                  color: "white",
                  cursor: running || pendingCount === 0 ? "not-allowed" : "pointer",
                  fontSize: "12px",
                  fontWeight: 700,
                  padding: "9px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px",
                  boxShadow:
                    running || pendingCount === 0
                      ? "none"
                      : "0 3px 14px rgba(99,102,241,0.3)",
                }}
              >
                {running ? (
                  <><Spinner /> Running…</>
                ) : pendingCount === 0 ? (
                  "All done"
                ) : (
                  `⚡ Run Queue (${pendingCount}${pendingCount < items.length ? `/${items.length}` : ""})`
                )}
              </button>
            );
          })()}
        </>
      )}
    </div>
  );
}

function Spinner({ color = "white" }: { color?: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: "12px",
        height: "12px",
        border: `2px solid ${color}40`,
        borderTopColor: color,
        borderRadius: "50%",
        animation: "popup-spin 0.7s linear infinite",
        flexShrink: 0,
      }}
    />
  );
}
