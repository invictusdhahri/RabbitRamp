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
import { JumpingRabbit } from "../shared/ui/JumpingRabbit";

// ─── Palette (mirrors popup) ──────────────────────────────────────────────────

const C = {
  bg: "#080b12",
  surface: "#0e1120",
  card: "#111420",
  border: "rgba(255,255,255,0.07)",
  borderHover: "rgba(255,255,255,0.13)",
  accent: "#f97316",
  accentDim: "rgba(249,115,22,0.14)",
  accentBorder: "rgba(249,115,22,0.38)",
  success: "#22c55e",
  successDim: "rgba(34,197,94,0.12)",
  successBorder: "rgba(34,197,94,0.28)",
  danger: "#ef4444",
  dangerDim: "rgba(239,68,68,0.12)",
  text: "#e2e8f0",
  textSub: "#94a3b8",
  textMuted: "#475569",
} as const;

// ─── Provider brand colors ────────────────────────────────────────────────────

const PROVIDER_COLORS: Record<AIProvider, { bg: string; border: string; color: string }> = {
  openai:    { bg: "rgba(16,163,127,0.15)",  border: "rgba(16,163,127,0.35)",  color: "#10a37f" },
  anthropic: { bg: "rgba(205,110,74,0.15)",  border: "rgba(205,110,74,0.35)",  color: "#cd6e4a" },
  gemini:    { bg: "rgba(66,133,244,0.15)",  border: "rgba(66,133,244,0.35)",  color: "#4285f4" },
};

// ─── Skill colors ─────────────────────────────────────────────────────────────

const SKILL_COLORS: Record<SkillType, { bg: string; color: string }> = {
  videoSkipper:     { bg: "rgba(6,182,212,0.14)",   color: "#22d3ee" },
  readingSkipper:   { bg: "rgba(234,179,8,0.14)",   color: "#facc15" },
  quizSolver:       { bg: "rgba(139,92,246,0.14)",  color: "#a78bfa" },
  assignmentWriter: { bg: "rgba(249,115,22,0.14)",  color: "#fdba74" },
  formFiller:       { bg: "rgba(34,197,94,0.14)",   color: "#86efac" },
};

// ─── Provider logos ───────────────────────────────────────────────────────────

function OpenAIIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.896zm16.597 3.855-5.843-3.369 2.02-1.168a.076.076 0 0 1 .071 0l4.83 2.786a4.494 4.494 0 0 1-.676 8.105v-5.677a.79.79 0 0 0-.402-.677zm2.01-3.023-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365 2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
    </svg>
  );
}

function AnthropicIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z" />
    </svg>
  );
}

function GeminiIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81" />
    </svg>
  );
}

function ProviderIcon({ provider, size = 16 }: { provider: AIProvider; size?: number }) {
  if (provider === "openai") return <OpenAIIcon size={size} />;
  if (provider === "anthropic") return <AnthropicIcon size={size} />;
  return <GeminiIcon size={size} />;
}

// ─── Provider config ──────────────────────────────────────────────────────────

const AI_PROVIDERS: {
  id: AIProvider;
  label: string;
  models: string[];
  placeholder: string;
}[] = [
  {
    id: "openai",
    label: "OpenAI",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
    placeholder: "sk-...",
  },
  {
    id: "anthropic",
    label: "Anthropic",
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
    <div style={{ background: C.bg, color: C.text, fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif", minHeight: "100vh" }}>
      {/* ── Header ── */}
      <div
        style={{
          background: C.surface,
          borderBottom: `1px solid ${C.border}`,
          padding: "20px 32px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <JumpingRabbit size={24} active={false} color={C.accent} />
          <div>
            <div style={{ fontWeight: 700, fontSize: "18px", color: C.text, letterSpacing: "0.2px" }}>
              RabbitRamp
            </div>
            <div style={{ fontSize: "11px", color: C.textMuted }}>Settings & API Keys</div>
          </div>
        </div>
        <button
          onClick={handleSave}
          style={{
            background: saved ? "#16a34a" : C.accent,
            border: `1px solid ${saved ? "#15803d" : "#2563eb"}`,
            borderRadius: "8px",
            color: "white",
            cursor: "pointer",
            fontSize: "13px",
            fontWeight: 600,
            padding: "8px 22px",
            transition: "all 0.2s",
            boxShadow: saved ? "0 0 12px rgba(22,163,74,0.35)" : "0 0 12px rgba(59,130,246,0.35)",
          }}
        >
          {saved ? "✓ Saved" : "Save Settings"}
        </button>
      </div>

      {/* ── Body ── */}
      <div
        style={{
          maxWidth: "680px",
          margin: "0 auto",
          padding: "32px 24px",
          display: "flex",
          flexDirection: "column",
          gap: "36px",
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
                    {/* Provider logo badge */}
                    <div
                      style={{
                        width: "32px",
                        height: "32px",
                        borderRadius: "7px",
                        background: PROVIDER_COLORS[p.id].bg,
                        border: `1px solid ${PROVIDER_COLORS[p.id].border}`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: PROVIDER_COLORS[p.id].color,
                        flexShrink: 0,
                      }}
                    >
                      <ProviderIcon provider={p.id} size={16} />
                    </div>
                    <span style={{ fontWeight: 600, fontSize: "14px", color: C.text }}>
                      {p.label}
                    </span>
                  </div>
                  <Toggle
                    checked={cfg.enabled}
                    onChange={(v) =>
                      patch((s) => ({
                        ...s,
                        providers: { ...s.providers, [p.id]: { ...cfg, enabled: v } },
                      }))
                    }
                  />
                </div>

                <div style={{ display: "flex", gap: "7px", marginBottom: "10px" }}>
                  <input
                    type="password"
                    value={cfg.apiKey}
                    onChange={(e) =>
                      patch((s) => ({
                        ...s,
                        providers: { ...s.providers, [p.id]: { ...cfg, apiKey: e.target.value } },
                      }))
                    }
                    placeholder={p.placeholder}
                    style={inputStyle}
                  />
                  <button
                    onClick={() => handleTest(p.id)}
                    disabled={!cfg.apiKey || state === "testing"}
                    style={{
                      borderRadius: "7px",
                      cursor: !cfg.apiKey || state === "testing" ? "not-allowed" : "pointer",
                      fontSize: "12px",
                      fontWeight: 600,
                      padding: "8px 14px",
                      flexShrink: 0,
                      transition: "all 0.15s",
                      border: `1px solid ${
                        state === "ok"
                          ? C.successBorder
                          : state === "error"
                          ? "rgba(239,68,68,0.3)"
                          : C.border
                      }`,
                      background:
                        state === "ok"
                          ? C.successDim
                          : state === "error"
                          ? C.dangerDim
                          : "rgba(255,255,255,0.04)",
                      color:
                        state === "ok"
                          ? "#86efac"
                          : state === "error"
                          ? "#f87171"
                          : C.textSub,
                    }}
                  >
                    {state === "testing" ? "…" : state === "ok" ? "✓ OK" : state === "error" ? "✗" : "Test"}
                  </button>
                </div>

                {err && (
                  <div style={{ color: "#f87171", fontSize: "11px", marginBottom: "8px" }}>
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
                        providers: { ...s.providers, [p.id]: { ...cfg, model: e.target.value } },
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
        <Section title="Provider Priority" subtitle="Determines the fallback chain — top entry is used first">
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
                    padding: "9px 10px",
                    background: "rgba(255,255,255,0.02)",
                    borderRadius: "7px",
                    marginBottom: idx < settings.providerPriority.length - 1 ? "5px" : 0,
                    border: `1px solid ${C.border}`,
                  }}
                >
                  <span style={{ color: C.textMuted, fontSize: "12px", minWidth: "18px", fontVariantNumeric: "tabular-nums" }}>
                    {idx + 1}.
                  </span>
                  <span
                    style={{
                      color: PROVIDER_COLORS[provider].color,
                      display: "flex",
                      alignItems: "center",
                      minWidth: "20px",
                      opacity: cfg.enabled ? 1 : 0.4,
                    }}
                  >
                    <ProviderIcon provider={provider} size={14} />
                  </span>
                  <span style={{ flex: 1, fontSize: "13px", color: C.textSub }}>{p.label}</span>
                  {cfg.enabled ? (
                    <span style={{ fontSize: "10px", color: "#4ade80" }}>enabled</span>
                  ) : (
                    <span style={{ fontSize: "10px", color: C.textMuted }}>disabled</span>
                  )}
                  <div style={{ display: "flex", gap: "3px" }}>
                    <SmallBtn onClick={() => movePriority(provider, -1)} disabled={idx === 0}>↑</SmallBtn>
                    <SmallBtn onClick={() => movePriority(provider, 1)} disabled={idx === settings.providerPriority.length - 1}>↓</SmallBtn>
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
                  borderBottom: i < SKILLS.length - 1 ? `1px solid ${C.border}` : "none",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <div style={{
                    width: "30px",
                    height: "30px",
                    borderRadius: "7px",
                    background: SKILL_COLORS[skill.id].bg,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "15px",
                    flexShrink: 0,
                  }}>
                    {skill.icon}
                  </div>
                  <span style={{ fontSize: "13px" }}>{skill.label}</span>
                </div>
                <Toggle
                  checked={settings.skills[skill.id]}
                  onChange={(v) =>
                    patch((s) => ({ ...s, skills: { ...s.skills, [skill.id]: v } }))
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
                  borderBottom: i < arr.length - 1 ? `1px solid ${C.border}` : "none",
                }}
              >
                <div>
                  <div style={{ fontSize: "13px", fontWeight: 500, color: C.text }}>{row.label}</div>
                  <div style={{ fontSize: "11px", color: C.textMuted, marginTop: "2px" }}>{row.desc}</div>
                </div>
                <Toggle
                  checked={settings[row.key]}
                  onChange={(v) => patch((s) => ({ ...s, [row.key]: v }))}
                />
              </div>
            ))}

            {/* Delay */}
            <div
              style={{
                paddingTop: "10px",
                borderTop: `1px solid ${C.border}`,
                marginTop: "4px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: "10px",
                }}
              >
                <div>
                  <div style={{ fontSize: "13px", fontWeight: 500, color: C.text }}>Action Delay</div>
                  <div style={{ fontSize: "11px", color: C.textMuted, marginTop: "2px" }}>
                    Milliseconds between actions
                  </div>
                </div>
                <span style={{ fontSize: "13px", color: C.textSub, fontVariantNumeric: "tabular-nums", minWidth: "52px", textAlign: "right" }}>
                  {settings.delayMs} ms
                </span>
              </div>
              <input
                type="range"
                min={200}
                max={3000}
                step={100}
                value={settings.delayMs}
                onChange={(e) => patch((s) => ({ ...s, delayMs: Number(e.target.value) }))}
                style={{ width: "100%", accentColor: C.accent }}
              />
            </div>
          </div>
        </Section>

        {/* Footer Save */}
        <div style={{ display: "flex", justifyContent: "flex-end", paddingBottom: "40px" }}>
          <button
            onClick={handleSave}
            style={{
              background: saved ? "#16a34a" : C.accent,
              border: `1px solid ${saved ? "#15803d" : "#2563eb"}`,
              borderRadius: "8px",
              color: "white",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: 600,
              padding: "10px 28px",
              transition: "all 0.2s",
              boxShadow: saved ? "0 0 12px rgba(22,163,74,0.35)" : "0 0 12px rgba(59,130,246,0.35)",
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
        <h2 style={{ fontSize: "15px", fontWeight: 700, color: C.text, marginBottom: "4px", display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{
            width: "5px",
            height: "5px",
            borderRadius: "50%",
            background: C.accent,
            display: "inline-block",
            flexShrink: 0,
            boxShadow: `0 0 6px ${C.accent}`,
          }} />
          {title}
        </h2>
        <p style={{ fontSize: "12px", color: C.textMuted, paddingLeft: "13px" }}>{subtitle}</p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {children}
      </div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      onClick={() => onChange(!checked)}
      style={{
        width: "38px",
        height: "21px",
        borderRadius: "11px",
        background: checked ? C.accent : "rgba(255,255,255,0.08)",
        cursor: "pointer",
        position: "relative",
        transition: "background 0.2s",
        flexShrink: 0,
        border: `1px solid ${checked ? "rgba(59,130,246,0.5)" : C.border}`,
      }}
    >
      <div
        style={{
          width: "15px",
          height: "15px",
          borderRadius: "50%",
          background: "white",
          position: "absolute",
          top: "2px",
          left: checked ? "20px" : "2px",
          transition: "left 0.2s",
          boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
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
        background: "rgba(255,255,255,0.04)",
        border: `1px solid ${C.border}`,
        borderRadius: "4px",
        color: disabled ? C.textMuted : C.textSub,
        cursor: disabled ? "default" : "pointer",
        fontSize: "11px",
        padding: "3px 7px",
        opacity: disabled ? 0.4 : 1,
        transition: "opacity 0.15s",
      }}
    >
      {children}
    </button>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: C.card,
  border: `1px solid ${C.border}`,
  borderRadius: "10px",
  padding: "16px",
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  background: "rgba(255,255,255,0.04)",
  border: `1px solid ${C.border}`,
  borderRadius: "7px",
  color: "white",
  fontSize: "13px",
  padding: "8px 11px",
  outline: "none",
};

const selectStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)",
  border: `1px solid ${C.border}`,
  borderRadius: "7px",
  color: "white",
  fontSize: "13px",
  padding: "8px 11px",
  width: "100%",
  outline: "none",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "10px",
  color: C.textMuted,
  marginBottom: "6px",
  textTransform: "uppercase",
  letterSpacing: "0.5px",
};
