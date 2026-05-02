import { useState, useEffect } from "react";
import { CourseContext, SkillStatus } from "../../shared/types";
import { JumpingRabbit } from "../../shared/ui/JumpingRabbit";

interface StatusBarProps {
  context: CourseContext;
  status: SkillStatus | "idle";
  message: string;
}

const ITEM_ICONS: Record<string, string> = {
  video: "▶",
  reading: "📖",
  quiz: "🧠",
  assignment: "✍",
  form: "📝",
  unknown: "📄",
};

// Single accent — matches popup C.accent
const ACCENT = "#f97316";
const ACCENT_DIM = "rgba(249,115,22,0.18)";
const ACCENT_BORDER = "rgba(249,115,22,0.38)";

export function StatusBar({ context, status, message }: StatusBarProps) {
  const [visible, setVisible] = useState(true);
  const [minimized, setMinimized] = useState(false);

  useEffect(() => {
    if (status === "done") {
      const t = setTimeout(() => setMinimized(true), 3000);
      return () => clearTimeout(t);
    }
  }, [status]);

  if (!visible) return null;

  const icon = ITEM_ICONS[context.itemType] ?? "📄";
  const isRunning = status === "running";

  return (
    <div
      style={{
        position: "fixed",
        bottom: "20px",
        right: "20px",
        zIndex: 2147483647,
        fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
        fontSize: "13px",
        transition: "all 0.25s ease",
        maxWidth: minimized ? "44px" : "310px",
        overflow: "hidden",
      }}
    >
      {minimized ? (
        /* Minimized FAB — rabbit mark */
        <button
          onClick={() => setMinimized(false)}
          style={{
            width: "40px",
            height: "40px",
            borderRadius: "10px",
            background: "#141519",
            border: `1px solid ${ACCENT_BORDER}`,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 2px 12px rgba(0,0,0,0.5)",
            color: ACCENT,
          }}
          title="RabbitRamp"
        >
          <JumpingRabbit size={20} active={isRunning} color={ACCENT} />
        </button>
      ) : (
        <div
          style={{
            background: "rgba(12, 13, 16, 0.97)",
            backdropFilter: "blur(14px)",
            WebkitBackdropFilter: "blur(14px)",
            borderRadius: "10px",
            border: `1px solid ${isRunning ? ACCENT_BORDER : "rgba(255,255,255,0.08)"}`,
            padding: "10px 12px",
            boxShadow: "0 6px 28px rgba(0,0,0,0.5)",
            color: "white",
            transition: "border-color 0.2s",
          }}
        >
          {/* Header row */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "8px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
              <JumpingRabbit size={16} active={isRunning} color={ACCENT} />
              <span
                style={{
                  fontWeight: 700,
                  fontSize: "12px",
                  color: "#e2e8f0",
                  letterSpacing: "0.3px",
                }}
              >
                RabbitRamp
              </span>
            </div>
            <div style={{ display: "flex", gap: "3px" }}>
              <button
                onClick={() => setMinimized(true)}
                style={iconBtnStyle}
                title="Minimize"
              >
                −
              </button>
              <button
                onClick={() => setVisible(false)}
                style={iconBtnStyle}
                title="Close"
              >
                ×
              </button>
            </div>
          </div>

          {/* Course info */}
          {context.courseName && (
            <div
              style={{
                fontSize: "11px",
                color: "#64748b",
                marginBottom: "3px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={context.courseName}
            >
              {context.courseName}
            </div>
          )}
          {context.weekLabel && (
            <div
              style={{
                fontSize: "11px",
                color: "#475569",
                marginBottom: "7px",
              }}
            >
              {context.weekLabel} · {icon} {context.itemTitle || context.itemType}
            </div>
          )}

          {/* Status row */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              background: isRunning ? ACCENT_DIM : "rgba(255,255,255,0.04)",
              borderRadius: "7px",
              padding: "7px 9px",
              transition: "background 0.2s",
            }}
          >
            {isRunning && (
              <Spinner />
            )}
            <span
              style={{
                color: isRunning ? "#fdba74" : status === "error" ? "#f87171" : "#86efac",
                fontSize: "12px",
                flex: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={message}
            >
              {message}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <span
      style={{
        display: "inline-block",
        width: "11px",
        height: "11px",
        border: "1.5px solid rgba(147,197,253,0.25)",
        borderTopColor: "#fdba74",
        borderRadius: "50%",
        animation: "rabbitramp-spin 0.7s linear infinite",
        flexShrink: 0,
      }}
    />
  );
}

const iconBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#475569",
  cursor: "pointer",
  fontSize: "15px",
  lineHeight: 1,
  padding: "2px 4px",
  borderRadius: "4px",
};

// ─── External state update ────────────────────────────────────────────────────

export interface StatusBarState {
  context: CourseContext;
  status: SkillStatus | "idle";
  message: string;
}

export function useStatusBarState(initial: StatusBarState) {
  const [state, setState] = useState<StatusBarState>(initial);
  return { state, setState };
}
