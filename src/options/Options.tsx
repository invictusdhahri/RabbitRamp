import { useEffect, useState } from "react";
import {
  AIProvider,
  DEFAULT_SETTINGS,
  Settings,
  SkillType,
} from "../shared/types";
import { getSettings, saveSettings } from "../shared/storage";
import { sendToBackground } from "../shared/messages";
import * as logger from "../shared/logger";

const AI_PROVIDERS: {
  id: AIProvider;
  label: string;
  icon: string;
  models: string[];
  placeholder: string;
}[] = [
  {
    id: "openai",
    label: "OpenAI",
    icon: "🟢",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
    placeholder: "sk-...",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    icon: "🟣",
    models: [
      "claude-3-5-haiku-20241022",
      "claude-3-5-sonnet-20241022",
      "claude-3-opus-20240229",
    ],
    placeholder: "sk-ant-...",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    icon: "🔵",
    models: [
      "gemini-2.0-flash",
      "gemini-2.0-flash-lite",
      "gemini-2.5-flash",
    ],
    placeholder: "AIza...",
  },
];

const SKILLS: { id: SkillType; label: string; icon: string }[] = [
  { id: "videoSkipper", label: "Video Skipper", icon: "▶" },
  { id: "readingSkipper", label: "Reading Skipper", icon: "📖" },
  { id: "quizSolver", label: "Quiz Solver", icon: "🧠" },
  { id: "assignmentWriter", label: "Assignment Writer", icon: "✍" },
  { id: "formFiller", label: "Form Filler", icon: "📝" },
];

type TestState = "idle" | "testing" | "ok" | "error";

export function Options() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [testStates, setTestStates] = useState<Record<AIProvider, TestState>>({
    openai: "idle",
    anthropic: "idle",
    gemini: "idle",
  });
  const [testErrors, setTestErrors] = useState<Record<AIProvider, string>>({
    openai: "",
    anthropic: "",
    gemini: "",
  });

  useEffect(() => {
    getSettings().then(setSettings);
  }, []);

  function patch(fn: (s: Settings) => Settings) {
    setSettings((prev) => fn(prev));
    setSaved(false);
  }

  async function handleSave() {
    logger.log("options", "saveSettings");
    await saveSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  async function handleTest(provider: AIProvider) {
    logger.log("options", "TEST_PROVIDER", { provider });
    setTestStates((prev) => ({ ...prev, [provider]: "testing" }));
    setTestErrors((prev) => ({ ...prev, [provider]: "" }));

    const tempSettings = settings;
    await saveSettings(tempSettings);

    const res = await sendToBackground<{
      type: string;
      payload: { ok: boolean; error?: string };
    }>({ type: "TEST_PROVIDER", payload: { provider } });

    if (res.payload.ok) {
      logger.log("options", "TEST_PROVIDER ok", { provider });
      setTestStates((prev) => ({ ...prev, [provider]: "ok" }));
      setTimeout(
        () => setTestStates((prev) => ({ ...prev, [provider]: "idle" })),
        3000
      );
    } else {
      logger.warn("options", "TEST_PROVIDER error", {
        provider,
        error: res.payload.error,
      });
      setTestStates((prev) => ({ ...prev, [provider]: "error" }));
      setTestErrors((prev) => ({
        ...prev,
        [provider]: res.payload.error ?? "Unknown error",
      }));
    }
  }

  function movePriority(provider: AIProvider, dir: -1 | 1) {
    const arr = [...settings.providerPriority];
    const idx = arr.indexOf(provider);
    const next = idx + dir;
    if (next < 0 || next >= arr.length) return;
    [arr[idx], arr[next]] = [arr[next], arr[idx]];
    patch((s) => ({ ...s, providerPriority: arr }));
  }

  return (
    <div
      style={{
        background: "#0a0a0f",
        color: "white",
        fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
        minHeight: "100vh",
        padding: "0",
      }}
    >
      {/* Header */}
      <div
        style={{
          background: "linear-gradient(135deg, #1e1b4b 0%, #0f0f14 100%)",
          borderBottom: "1px solid rgba(99,102,241,0.2)",
          padding: "24px 32px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{ fontSize: "28px" }}>⚡</span>
          <div>
            <div
              style={{
                fontWeight: 800,
                fontSize: "22px",
                background: "linear-gradient(90deg, #818cf8, #c084fc)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              CoursCheat
            </div>
            <div style={{ fontSize: "12px", color: "#64748b" }}>
              Settings & API Keys
            </div>
          </div>
        </div>
        <button
          onClick={handleSave}
          style={{
            background: saved
              ? "rgba(34,197,94,0.2)"
              : "linear-gradient(135deg, #6366f1, #8b5cf6)",
            border: saved ? "1px solid rgba(34,197,94,0.4)" : "none",
            borderRadius: "10px",
            color: saved ? "#86efac" : "white",
            cursor: "pointer",
            fontSize: "14px",
            fontWeight: 700,
            padding: "10px 24px",
            transition: "all 0.3s",
          }}
        >
          {saved ? "✓ Saved" : "Save Settings"}
        </button>
      </div>

      <div
        style={{
          maxWidth: "720px",
          margin: "0 auto",
          padding: "32px",
          display: "flex",
          flexDirection: "column",
          gap: "28px",
        }}
      >
        {/* AI Providers */}
        <Section title="AI Providers" subtitle="Configure API keys for each provider">
          {AI_PROVIDERS.map((p) => {
            const cfg = settings.providers[p.id];
            const state = testStates[p.id];
            const err = testErrors[p.id];

            return (
              <div key={p.id} style={cardStyle}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: "14px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span style={{ fontSize: "18px" }}>{p.icon}</span>
                    <span style={{ fontWeight: 600, fontSize: "14px" }}>
                      {p.label}
                    </span>
                  </div>
                  <Toggle
                    checked={cfg.enabled}
                    onChange={(v) =>
                      patch((s) => ({
                        ...s,
                        providers: {
                          ...s.providers,
                          [p.id]: { ...cfg, enabled: v },
                        },
                      }))
                    }
                  />
                </div>

                <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
                  <input
                    type="password"
                    value={cfg.apiKey}
                    onChange={(e) =>
                      patch((s) => ({
                        ...s,
                        providers: {
                          ...s.providers,
                          [p.id]: { ...cfg, apiKey: e.target.value },
                        },
                      }))
                    }
                    placeholder={p.placeholder}
                    style={inputStyle}
                  />
                  <button
                    onClick={() => handleTest(p.id)}
                    disabled={!cfg.apiKey || state === "testing"}
                    style={{
                      ...testBtnStyle,
                      background:
                        state === "ok"
                          ? "rgba(34,197,94,0.15)"
                          : state === "error"
                          ? "rgba(239,68,68,0.15)"
                          : "rgba(99,102,241,0.15)",
                      border:
                        state === "ok"
                          ? "1px solid rgba(34,197,94,0.3)"
                          : state === "error"
                          ? "1px solid rgba(239,68,68,0.3)"
                          : "1px solid rgba(99,102,241,0.3)",
                      color:
                        state === "ok"
                          ? "#86efac"
                          : state === "error"
                          ? "#f87171"
                          : "#a5b4fc",
                    }}
                  >
                    {state === "testing"
                      ? "…"
                      : state === "ok"
                      ? "✓"
                      : state === "error"
                      ? "✗"
                      : "Test"}
                  </button>
                </div>

                {err && (
                  <div
                    style={{
                      color: "#f87171",
                      fontSize: "11px",
                      marginBottom: "8px",
                    }}
                  >
                    {err}
                  </div>
                )}

                <div>
                  <label style={labelStyle}>Model</label>
                  <select
                    value={cfg.model}
                    onChange={(e) =>
                      patch((s) => ({
                        ...s,
                        providers: {
                          ...s.providers,
                          [p.id]: { ...cfg, model: e.target.value },
                        },
                      }))
                    }
                    style={selectStyle}
                  >
                    {p.models.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}
        </Section>

        {/* Provider Priority */}
        <Section
          title="Provider Priority"
          subtitle="Drag order determines fallback chain (top = primary)"
        >
          <div style={cardStyle}>
            {settings.providerPriority.map((provider, idx) => {
              const p = AI_PROVIDERS.find((x) => x.id === provider)!;
              const cfg = settings.providers[provider];
              return (
                <div
                  key={provider}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    padding: "10px 12px",
                    background: "rgba(255,255,255,0.03)",
                    borderRadius: "8px",
                    marginBottom: idx < settings.providerPriority.length - 1 ? "6px" : 0,
                    border: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  <span style={{ color: "#475569", fontSize: "13px", minWidth: "18px" }}>
                    {idx + 1}.
                  </span>
                  <span>{p.icon}</span>
                  <span style={{ flex: 1, fontSize: "13px" }}>{p.label}</span>
                  {cfg.enabled ? (
                    <span style={{ fontSize: "10px", color: "#86efac" }}>enabled</span>
                  ) : (
                    <span style={{ fontSize: "10px", color: "#475569" }}>disabled</span>
                  )}
                  <div style={{ display: "flex", gap: "4px" }}>
                    <SmallBtn
                      onClick={() => movePriority(provider, -1)}
                      disabled={idx === 0}
                    >
                      ↑
                    </SmallBtn>
                    <SmallBtn
                      onClick={() => movePriority(provider, 1)}
                      disabled={idx === settings.providerPriority.length - 1}
                    >
                      ↓
                    </SmallBtn>
                  </div>
                </div>
              );
            })}
          </div>
        </Section>

        {/* Skill Toggles */}
        <Section title="Skills" subtitle="Enable or disable individual skill modules">
          <div style={cardStyle}>
            {SKILLS.map((skill, i) => (
              <div
                key={skill.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 0",
                  borderBottom:
                    i < SKILLS.length - 1
                      ? "1px solid rgba(255,255,255,0.05)"
                      : "none",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span>{skill.icon}</span>
                  <span style={{ fontSize: "13px" }}>{skill.label}</span>
                </div>
                <Toggle
                  checked={settings.skills[skill.id]}
                  onChange={(v) =>
                    patch((s) => ({
                      ...s,
                      skills: { ...s.skills, [skill.id]: v },
                    }))
                  }
                />
              </div>
            ))}
          </div>
        </Section>

        {/* Behavior */}
        <Section title="Behavior" subtitle="Control how skills act after completion">
          <div style={cardStyle}>
            {(
              [
                {
                  key: "autoSubmit" as const,
                  label: "Auto Submit",
                  desc: "Automatically submit quizzes and assignments",
                },
                {
                  key: "autoNext" as const,
                  label: "Auto Next",
                  desc: "Click Next after completing each item",
                },
              ] as const
            ).map((row, i, arr) => (
              <div
                key={row.key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 0",
                  borderBottom:
                    i < arr.length - 1
                      ? "1px solid rgba(255,255,255,0.05)"
                      : "none",
                }}
              >
                <div>
                  <div style={{ fontSize: "13px", fontWeight: 500 }}>
                    {row.label}
                  </div>
                  <div style={{ fontSize: "11px", color: "#64748b" }}>
                    {row.desc}
                  </div>
                </div>
                <Toggle
                  checked={settings[row.key]}
                  onChange={(v) =>
                    patch((s) => ({ ...s, [row.key]: v }))
                  }
                />
              </div>
            ))}

            {/* Delay */}
            <div
              style={{
                paddingTop: "10px",
                borderTop: "1px solid rgba(255,255,255,0.05)",
                marginTop: "4px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: "8px",
                }}
              >
                <div>
                  <div style={{ fontSize: "13px", fontWeight: 500 }}>
                    Action Delay
                  </div>
                  <div style={{ fontSize: "11px", color: "#64748b" }}>
                    Milliseconds between actions ({settings.delayMs}ms)
                  </div>
                </div>
                <span style={{ fontSize: "13px", color: "#a5b4fc", minWidth: "52px", textAlign: "right" }}>
                  {settings.delayMs}ms
                </span>
              </div>
              <input
                type="range"
                min={200}
                max={3000}
                step={100}
                value={settings.delayMs}
                onChange={(e) =>
                  patch((s) => ({ ...s, delayMs: Number(e.target.value) }))
                }
                style={{ width: "100%", accentColor: "#6366f1" }}
              />
            </div>
          </div>
        </Section>

        {/* Footer Save */}
        <div style={{ display: "flex", justifyContent: "flex-end", paddingBottom: "32px" }}>
          <button
            onClick={handleSave}
            style={{
              background: saved
                ? "rgba(34,197,94,0.2)"
                : "linear-gradient(135deg, #6366f1, #8b5cf6)",
              border: saved ? "1px solid rgba(34,197,94,0.4)" : "none",
              borderRadius: "10px",
              color: saved ? "#86efac" : "white",
              cursor: "pointer",
              fontSize: "14px",
              fontWeight: 700,
              padding: "12px 32px",
              transition: "all 0.3s",
            }}
          >
            {saved ? "✓ Saved" : "Save Settings"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div style={{ marginBottom: "14px" }}>
        <h2
          style={{
            fontSize: "16px",
            fontWeight: 700,
            color: "#e2e8f0",
            marginBottom: "4px",
          }}
        >
          {title}
        </h2>
        <p style={{ fontSize: "12px", color: "#64748b" }}>{subtitle}</p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {children}
      </div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      onClick={() => onChange(!checked)}
      style={{
        width: "40px",
        height: "22px",
        borderRadius: "11px",
        background: checked
          ? "linear-gradient(135deg, #6366f1, #8b5cf6)"
          : "rgba(255,255,255,0.1)",
        cursor: "pointer",
        position: "relative",
        transition: "all 0.25s",
        flexShrink: 0,
        boxShadow: checked ? "0 0 10px rgba(99,102,241,0.4)" : "none",
      }}
    >
      <div
        style={{
          width: "16px",
          height: "16px",
          borderRadius: "50%",
          background: "white",
          position: "absolute",
          top: "3px",
          left: checked ? "21px" : "3px",
          transition: "left 0.25s",
        }}
      />
    </div>
  );
}

function SmallBtn({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: "rgba(99,102,241,0.1)",
        border: "1px solid rgba(99,102,241,0.2)",
        borderRadius: "4px",
        color: disabled ? "#334155" : "#a5b4fc",
        cursor: disabled ? "default" : "pointer",
        fontSize: "11px",
        padding: "3px 7px",
      }}
    >
      {children}
    </button>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: "12px",
  padding: "16px",
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "8px",
  color: "white",
  fontSize: "13px",
  padding: "8px 12px",
  outline: "none",
};

const selectStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "8px",
  color: "white",
  fontSize: "13px",
  padding: "8px 12px",
  width: "100%",
  outline: "none",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "11px",
  color: "#64748b",
  marginBottom: "6px",
  textTransform: "uppercase",
  letterSpacing: "0.5px",
};

const testBtnStyle: React.CSSProperties = {
  borderRadius: "8px",
  cursor: "pointer",
  fontSize: "13px",
  fontWeight: 600,
  padding: "8px 14px",
  flexShrink: 0,
  transition: "all 0.2s",
};
