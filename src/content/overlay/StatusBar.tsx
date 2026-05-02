import { useState, useEffect } from "react";
import { CourseContext, SkillStatus } from "../../shared/types";

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

export function StatusBar({ context, status, message }: StatusBarProps) {
  const [visible, setVisible] = useState(true);
  const [minimized, setMinimized] = useState(false);

  // Auto-hide after done
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
        transition: "all 0.3s ease",
        maxWidth: minimized ? "48px" : "320px",
        overflow: "hidden",
      }}
    >
      {minimized ? (
        <button
          onClick={() => setMinimized(false)}
          style={{
            width: "44px",
            height: "44px",
            borderRadius: "50%",
            background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
            border: "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "20px",
            boxShadow: "0 4px 20px rgba(99,102,241,0.4)",
            color: "white",
          }}
          title="CoursCheat"
        >
          ⚡
        </button>
      ) : (
        <div
          style={{
            background: "rgba(15, 15, 20, 0.95)",
            backdropFilter: "blur(12px)",
            borderRadius: "12px",
            border: "1px solid rgba(99,102,241,0.3)",
            padding: "12px 14px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            color: "white",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "8px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ fontSize: "16px" }}>⚡</span>
              <span
                style={{
                  fontWeight: 700,
                  fontSize: "12px",
                  background: "linear-gradient(90deg, #6366f1, #a78bfa)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  letterSpacing: "0.5px",
                }}
              >
                COURSCHEAT
              </span>
            </div>
            <div style={{ display: "flex", gap: "4px" }}>
              <button
                onClick={() => setMinimized(true)}
                style={iconBtn}
                title="Minimize"
              >
                −
              </button>
              <button
                onClick={() => setVisible(false)}
                style={iconBtn}
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
                color: "#94a3b8",
                marginBottom: "4px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={context.courseName}
            >
              🎓 {context.courseName}
            </div>
          )}
          {context.weekLabel && (
            <div
              style={{
                fontSize: "11px",
                color: "#64748b",
                marginBottom: "8px",
              }}
            >
              {context.weekLabel} · {icon} {context.itemTitle || context.itemType}
            </div>
          )}

          {/* Status */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              background: "rgba(255,255,255,0.05)",
              borderRadius: "8px",
              padding: "8px 10px",
            }}
          >
            {isRunning && <Spinner />}
            <span
              style={{
                color: isRunning ? "#a78bfa" : status === "error" ? "#f87171" : "#86efac",
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
        width: "12px",
        height: "12px",
        border: "2px solid rgba(167,139,250,0.3)",
        borderTopColor: "#a78bfa",
        borderRadius: "50%",
        animation: "courscheat-spin 0.7s linear infinite",
        flexShrink: 0,
      }}
    />
  );
}

const iconBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#64748b",
  cursor: "pointer",
  fontSize: "16px",
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
