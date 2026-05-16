import { useEffect, useRef, useState } from "react";
import { CourseContext, CourseItem, ItemType, Settings, SkillType } from "../shared/types";
import { DEFAULT_SETTINGS } from "../shared/types";
import { getSettings } from "../shared/storage";
import { Message } from "../shared/messages";
import * as logger from "../shared/logger";
import { buildCourseHomeUrl, isCourseHomePage } from "../shared/courseraUrls";
import { JumpingRabbit } from "../shared/ui/JumpingRabbit";

// ─── Palette ─────────────────────────────────────────────────────────────────

const C = {
  bg: "#080b12",
  surface: "#0e1120",
  border: "rgba(255,255,255,0.07)",
  borderHover: "rgba(255,255,255,0.13)",
  accent: "#f97316",       // orange — primary actions
  accentDim: "rgba(249,115,22,0.14)",
  accentBorder: "rgba(249,115,22,0.38)",
  amber: "#f59e0b",        // amber — GET DEGREE CTA only
  amberDim: "rgba(245,158,11,0.15)",
  amberBorder: "rgba(245,158,11,0.35)",
  danger: "#ef4444",
  dangerDim: "rgba(239,68,68,0.12)",
  success: "#22c55e",
  successDim: "rgba(34,197,94,0.12)",
  text: "#e2e8f0",
  textSub: "#94a3b8",
  textMuted: "#475569",
} as const;

// ─── Skill colors ─────────────────────────────────────────────────────────────

const SKILL_COLORS: Record<SkillType, { bg: string; border: string; color: string }> = {
  videoSkipper:       { bg: "rgba(6,182,212,0.16)",   border: "rgba(6,182,212,0.35)",   color: "#22d3ee" },
  readingSkipper:     { bg: "rgba(234,179,8,0.16)",   border: "rgba(234,179,8,0.35)",   color: "#facc15" },
  quizSolver:         { bg: "rgba(139,92,246,0.16)",  border: "rgba(139,92,246,0.35)",  color: "#a78bfa" },
  assignmentWriter:   { bg: "rgba(59,130,246,0.16)",  border: "rgba(59,130,246,0.35)",  color: "#93c5fd" },
  formFiller:         { bg: "rgba(34,197,94,0.16)",   border: "rgba(34,197,94,0.35)",   color: "#86efac" },
  discussionSkipper:  { bg: "rgba(236,72,153,0.16)",  border: "rgba(236,72,153,0.35)",  color: "#f472b6" },
  pluginSkipper:      { bg: "rgba(20,184,166,0.16)",  border: "rgba(20,184,166,0.35)",  color: "#2dd4bf" },
};

// ─── Skill config ─────────────────────────────────────────────────────────────

type QueueProgressState = {
  running: boolean;
  index: number;
  total: number;
  getDegreePhase: null | "navigating" | "scraping" | "running";
};

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
    description: "Mark video complete via API",
    relevantFor: ["video"],
  },
  {
    id: "readingSkipper",
    label: "Skip Reading",
    icon: "📖",
    description: "Mark reading complete via API",
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
  {
    id: "discussionSkipper",
    label: "Skip Discussion",
    icon: "💬",
    description: "Post reply via API",
    relevantFor: ["discussion", "unknown"],
  },
  {
    id: "pluginSkipper",
    label: "Skip Plugin",
    icon: "🔌",
    description: "Mark lab/widget complete via API",
    relevantFor: ["plugin", "unknown"],
  },
];

const ITEM_ICONS: Record<ItemType, string> = {
  video: "▶",
  reading: "📖",
  quiz: "🧠",
  assignment: "✍",
  form: "📝",
  discussion: "💬",
  plugin: "🔌",
  unknown: "📄",
};

const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  video: "Video",
  reading: "Reading",
  quiz: "Quiz",
  assignment: "Assignment",
  form: "Form",
  discussion: "Discussion",
  plugin: "Plugin",
  unknown: "Item",
};

// ─── Component ────────────────────────────────────────────────────────────────

export function Popup() {
  const [context, setContext] = useState<CourseContext | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [statusLog, setStatusLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [hasProviders, setHasProviders] = useState(false);

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

    let skipNavigate = false;
    try {
      await new Promise<void>((resolve, reject) => {
        chrome.runtime.sendMessage(
          { type: "GET_DEGREE_ARM", payload: { tabId } } satisfies Message,
          (
            res:
              | { ok?: boolean; skipNavigate?: boolean; error?: string }
              | undefined
          ) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            if (res && res.ok === false) {
              reject(new Error(res.error ?? "GET_DEGREE_ARM failed"));
              return;
            }
            skipNavigate = res?.skipNavigate === true;
            resolve();
          }
        );
      });
    } catch (e: unknown) {
      addLog(`Get Degree failed: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    startRunning();
    setCourseItems([]);
    addLog(
      skipNavigate
        ? "Already on assignments — scanning…"
        : "Navigating to assignments page…"
    );
    if (!skipNavigate) {
      chrome.tabs.update(tabId, { url: homeUrl });
    }
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

  // ─── Effects ──────────────────────────────────────────────────────────────

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

  // ─── Derived ──────────────────────────────────────────────────────────────

  const activeProvider = settings.providerPriority.find(
    (p) => settings.providers[p].enabled && settings.providers[p].apiKey
  ) ?? null;
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
          : "Get Degree";

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        background: C.bg,
        color: C.text,
        fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
        fontSize: "13px",
        width: "340px",
      }}
    >
      {/* ── Header ── */}
      <div
        style={{
          background: C.surface,
          borderBottom: `1px solid ${C.border}`,
          padding: "12px 14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
          <div style={{
            width: "34px",
            height: "34px",
            borderRadius: "9px",
            background: "rgba(249,115,22,0.13)",
            border: "1px solid rgba(249,115,22,0.28)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}>
            <JumpingRabbit size={20} active={busy} color={C.accent} />
          </div>
          <div>
            <div
              style={{
                fontWeight: 700,
                fontSize: "14px",
                color: C.text,
                letterSpacing: "0.2px",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              RabbitRamp
              {activeProvider && (
                <span
                  style={{
                    fontSize: "9px",
                    fontWeight: 600,
                    padding: "2px 5px",
                    borderRadius: "4px",
                    background:
                      activeProvider === "groq"
                        ? "rgba(249,115,22,0.18)"
                        : activeProvider === "openai"
                          ? "rgba(16,163,127,0.18)"
                          : activeProvider === "anthropic"
                            ? "rgba(205,110,74,0.18)"
                            : "rgba(66,133,244,0.18)",
                    color:
                      activeProvider === "groq"
                        ? "#f97316"
                        : activeProvider === "openai"
                          ? "#10a37f"
                          : activeProvider === "anthropic"
                            ? "#cd6e4a"
                            : "#4285f4",
                    textTransform: "uppercase",
                    letterSpacing: "0.4px",
                    border: `1px solid ${
                      activeProvider === "groq"
                        ? "rgba(249,115,22,0.3)"
                        : activeProvider === "openai"
                          ? "rgba(16,163,127,0.3)"
                          : activeProvider === "anthropic"
                            ? "rgba(205,110,74,0.3)"
                            : "rgba(66,133,244,0.3)"
                    }`,
                  }}
                >
                  {activeProvider === "groq" ? "Groq" : activeProvider}
                </span>
              )}
            </div>
            <div style={{ fontSize: "10px", color: C.textMuted, letterSpacing: "0.3px" }}>
              Coursera Autopilot
            </div>
          </div>
        </div>
        <button
          onClick={() => chrome.runtime.openOptionsPage()}
          style={ghostBtn}
        >
          ⚙ Settings
        </button>
      </div>

      {/* ── Course Info ── */}
      <div
        style={{
          padding: "10px 14px",
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        {!isCoursera ? (
          <div style={{ ...infoCard, borderColor: "rgba(245,158,11,0.25)", color: "#fbbf24" }}>
            Navigate to a Coursera page to use RabbitRamp.
          </div>
        ) : (
          <div style={infoCard}>
            {context?.courseName ? (
              <>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: "12px",
                    color: C.text,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={context.courseName}
                >
                  {context.courseName}
                </div>
                {onHomePage ? (
                  <div style={{ fontSize: "11px", color: C.textSub, marginTop: "2px" }}>
                    Assignments page — scan or auto-run below
                  </div>
                ) : context.weekLabel ? (
                  <div style={{ fontSize: "11px", color: C.textSub, marginTop: "2px" }}>
                    {context.weekLabel}
                    {context.itemType !== "unknown" && (
                      <> · {ITEM_ICONS[context.itemType]} {context.itemTitle || context.itemType}</>
                    )}
                  </div>
                ) : null}
              </>
            ) : (
              <div style={{ color: C.textMuted, fontSize: "12px" }}>Detecting course…</div>
            )}
          </div>
        )}

        {!hasProviders && (
          <div
            style={{
              marginTop: "8px",
              background: C.dangerDim,
              border: `1px solid rgba(239,68,68,0.22)`,
              borderRadius: "7px",
              padding: "8px 11px",
              color: "#f87171",
              fontSize: "11px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <span style={{ flex: 1 }}>No AI provider configured.</span>
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
                flexShrink: 0,
              }}
            >
              Add API key →
            </button>
          </div>
        )}
      </div>

      {/* ── GET DEGREE ── */}
      {isCoursera && hasCourseSlug && (
        <div style={{ padding: "10px 14px 0" }}>
          <button
            onClick={sendGetDegree}
            disabled={busy}
            title="Navigate to the assignments page, scan all graded items, and complete them automatically"
            style={{
              width: "100%",
              background: busy && getDegreePhase
                ? C.amberDim
                : busy
                  ? "rgba(245,158,11,0.08)"
                  : "rgba(245,158,11,0.15)",
              border: `1px solid ${busy && getDegreePhase ? C.amberBorder : "rgba(245,158,11,0.3)"}`,
              borderRadius: "8px",
              color: busy && getDegreePhase ? "#fbbf24" : C.amber,
              cursor: busy ? "not-allowed" : "pointer",
              fontSize: "12px",
              fontWeight: 700,
              padding: "10px 12px",
              letterSpacing: "0.5px",
              transition: "all 0.15s",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              textTransform: "uppercase",
            }}
          >
            {getDegreePhase ? (
              <>
                <JumpingRabbit size={15} active color={C.amber} />
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
                height: "2px",
                borderRadius: "2px",
                background: "rgba(255,255,255,0.06)",
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
                  background: C.amber,
                  borderRadius: "2px",
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
                marginTop: "7px",
                background: C.dangerDim,
                border: `1px solid rgba(239,68,68,0.3)`,
                borderRadius: "7px",
                color: "#f87171",
                cursor: "pointer",
                fontSize: "11px",
                fontWeight: 600,
                padding: "7px 10px",
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
        <div style={{ padding: "10px 14px 14px" }}>
          <SectionLabel>Current page</SectionLabel>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "5px",
              marginBottom: "8px",
            }}
          >
            {SKILLS.map((skill) => {
              const isRelevant = context?.itemType
                ? skill.relevantFor.includes(context.itemType)
                : false;
              const isEnabled = settings.skills[skill.id];
              const sc = SKILL_COLORS[skill.id];

              return (
                <button
                  key={skill.id}
                  onClick={() => sendSkill(skill.id)}
                  disabled={busy || !isEnabled}
                  title={skill.description}
                  style={{
                    background: isRelevant ? sc.bg : "rgba(255,255,255,0.025)",
                    border: `1px solid ${isRelevant ? sc.border : C.border}`,
                    borderRadius: "7px",
                    color: isRelevant ? sc.color : C.textMuted,
                    cursor: busy || !isEnabled ? "not-allowed" : "pointer",
                    fontSize: "12px",
                    fontWeight: isRelevant ? 600 : 400,
                    padding: "8px 10px",
                    textAlign: "left",
                    transition: "all 0.15s",
                    opacity: !isEnabled ? 0.38 : 1,
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <span style={{
                    fontSize: "13px",
                    width: "18px",
                    height: "18px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: "4px",
                    background: isRelevant ? "rgba(255,255,255,0.07)" : "transparent",
                    flexShrink: 0,
                  }}>{skill.icon}</span>
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
              background: busy ? C.accentDim : C.accent,
              border: `1px solid ${busy ? C.accentBorder : "#ea6c0a"}`,
              borderRadius: "8px",
              color: busy ? "#fdba74" : "white",
              cursor: busy ? "not-allowed" : "pointer",
              fontSize: "12px",
              fontWeight: 700,
              padding: "10px",
              letterSpacing: "0.3px",
              transition: "all 0.15s",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "7px",
              boxShadow: busy ? "none" : "0 0 14px rgba(249,115,22,0.4)",
            }}
          >
            {running && !queueProgress.running ? (
              <>
                <JumpingRabbit size={14} active color="#fdba74" />
                Running…
              </>
            ) : (
              "Do Everything"
            )}
          </button>
        </div>
      )}

      {/* ── Status Log ── */}
      {statusLog.length > 0 && (
        <div
          style={{
            borderTop: `1px solid ${C.border}`,
            padding: "8px 14px 11px",
          }}
        >
          <SectionLabel>Log</SectionLabel>
          <div
            ref={logRef}
            style={{
              maxHeight: "78px",
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
                  color: i === statusLog.length - 1 ? C.textSub : C.textMuted,
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
}

// ─── CourseHomePanel ──────────────────────────────────────────────────────────

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
    quiz: "rgba(139,92,246,0.16)",
    assignment: "rgba(59,130,246,0.16)",
    form: "rgba(34,197,94,0.14)",
    video: "rgba(6,182,212,0.14)",
    reading: "rgba(234,179,8,0.14)",
    discussion: "rgba(236,72,153,0.14)",
    plugin: "rgba(20,184,166,0.14)",
    unknown: "rgba(100,116,139,0.12)",
  };

  const TYPE_TEXT: Record<ItemType, string> = {
    quiz: "#a78bfa",
    assignment: "#93c5fd",
    form: "#86efac",
    video: "#22d3ee",
    reading: "#facc15",
    discussion: "#f472b6",
    plugin: "#2dd4bf",
    unknown: "#94a3b8",
  };

  return (
    <div style={{ padding: "10px 14px 14px" }}>
      <SectionLabel>Manual scan</SectionLabel>

      <button
        onClick={onScan}
        disabled={scanning || running}
        style={{
          width: "100%",
          background: scanning || running ? C.accentDim : "rgba(249,115,22,0.1)",
          border: `1px solid ${scanning || running ? C.accentBorder : "rgba(249,115,22,0.28)"}`,
          borderRadius: "7px",
          color: scanning || running ? C.textMuted : "#fdba74",
          cursor: scanning || running ? "not-allowed" : "pointer",
          fontSize: "12px",
          fontWeight: 600,
          padding: "8px",
          marginBottom: items.length > 0 ? "8px" : "0",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "6px",
          transition: "all 0.15s",
        }}
      >
        {scanning ? (
          <>
            <JumpingRabbit size={14} active color={C.accent} />
            Scanning…
          </>
        ) : (
          "Scan Assignments"
        )}
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
                  color: C.textMuted,
                  textTransform: "uppercase",
                  letterSpacing: "0.7px",
                  marginBottom: "5px",
                  display: "flex",
                  gap: "8px",
                }}
              >
                <span>{items.length} item{items.length !== 1 ? "s" : ""} found</span>
                {doneCount > 0 && (
                  <span style={{ color: "#4ade80" }}>{doneCount} done</span>
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
                    background: isCurrent ? C.accentDim : "rgba(255,255,255,0.025)",
                    border: `1px solid ${
                      isCurrent
                        ? C.accentBorder
                        : isAlreadyCompleted
                        ? "rgba(34,197,94,0.18)"
                        : C.border
                    }`,
                    borderRadius: "5px",
                    padding: "5px 7px",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    opacity: faded ? 0.38 : 1,
                    transition: "opacity 0.2s",
                  }}
                >
                  <span style={{ fontSize: "12px", flexShrink: 0, width: "16px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {isCurrent ? (
                      <JumpingRabbit size={14} active color="#fdba74" />
                    ) : isQueueDone || isAlreadyCompleted ? (
                      "✓"
                    ) : (
                      ITEM_ICONS[item.itemType]
                    )}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      fontSize: "11px",
                      color: isCurrent ? C.text : C.textSub,
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
                        background: "rgba(34,197,94,0.12)",
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
                  background: running || pendingCount === 0 ? C.accentDim : C.accent,
                  border: `1px solid ${running || pendingCount === 0 ? C.accentBorder : "#ea6c0a"}`,
                  borderRadius: "7px",
                  color: running || pendingCount === 0 ? "#fdba74" : "white",
                  cursor: running || pendingCount === 0 ? "not-allowed" : "pointer",
                  fontSize: "12px",
                  fontWeight: 700,
                  padding: "9px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px",
                  transition: "all 0.15s",
                  boxShadow: running || pendingCount === 0 ? "none" : "0 0 12px rgba(249,115,22,0.35)",
                }}
              >
                {running ? (
                  <>
                    <JumpingRabbit size={14} active color="#fdba74" />
                    Running…
                  </>
                ) : pendingCount === 0 ? (
                  "✓ All done"
                ) : (
                  `Run Queue (${pendingCount}${pendingCount < items.length ? `/${items.length}` : ""})`
                )}
              </button>
            );
          })()}
        </>
      )}
    </div>
  );
}

// ─── Shared mini components ───────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: "10px",
        color: C.textMuted,
        textTransform: "uppercase",
        letterSpacing: "0.7px",
        marginBottom: "6px",
        marginTop: "4px",
      }}
    >
      {children}
    </div>
  );
}

const ghostBtn: React.CSSProperties = {
  background: "rgba(249,115,22,0.08)",
  border: "1px solid rgba(249,115,22,0.22)",
  borderRadius: "6px",
  color: "#fdba74",
  cursor: "pointer",
  fontSize: "11px",
  fontWeight: 500,
  padding: "4px 9px",
  transition: "all 0.15s",
};

const infoCard: React.CSSProperties = {
  background: "rgba(255,255,255,0.03)",
  border: `1px solid ${C.border}`,
  borderRadius: "7px",
  padding: "9px 11px",
};
