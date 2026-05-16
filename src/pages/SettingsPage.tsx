import { useEffect, useMemo, useState, useCallback } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  Moon,
  RefreshCw,
  Sun,
  Cpu,
  Sparkles,
} from "lucide-react";
import { api, type AppSettings, type OllamaModel } from "@/lib/tauri";
import { useTheme } from "@/lib/useTheme";

/**
 * Settings page. Structured as a provider hub rather than a flat form:
 *  - Top hero shows the *currently active* provider + model with a
 *    compact switcher. If you already use Gemini, Gemini isn't
 *    repeated below as an always-open input.
 *  - "Other providers" lists only inactive options. Each row is
 *    collapsed until clicked, then expands to reveal a key input or
 *    local-runtime config. Deliberate, not noisy.
 *  - Advanced routing (tabular / title models) is collapsible.
 *  - Profile / Appearance / About live below as short rails.
 *
 * Routine fields auto-save on blur. API keys require an explicit save
 * click inside the provider row — they're sensitive and should be a
 * deliberate action.
 */

type ProviderId = "gemini" | "ollama";

interface ModelDef {
  value: string;
  label: string;
  description: string;
}

interface ProviderDef {
  id: ProviderId;
  name: string;
  tagline: string;
  models: ModelDef[];
  keyPlaceholder?: string;
  keyHelpUrl?: string;
  /** Local-runtime provider — configured by URL, not API key. */
  isLocal?: boolean;
  /** Backend implementation still pending. Shown but not yet functional. */
  comingSoon?: boolean;
}

const PROVIDERS: readonly ProviderDef[] = [
  {
    id: "gemini",
    name: "Google Gemini",
    tagline: "Fast, long context, multimodal. Holmes's recommended provider.",
    models: [
      { value: "gemini-3-flash-preview", label: "Gemini 3 Flash", description: "Balanced speed and quality" },
      { value: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", description: "Deepest reasoning" },
      { value: "gemini-3.1-flash-lite-preview", label: "Gemini 3.1 Flash Lite", description: "Lightest, for background tasks" },
    ],
    keyPlaceholder: "AIza…",
    keyHelpUrl: "https://aistudio.google.com/apikey",
  },
  {
    id: "ollama",
    name: "Ollama",
    tagline: "Run models fully offline on your own hardware. No API key needed.",
    // Models are discovered live from the local Ollama server at runtime.
    models: [],
    isLocal: true,
  },
];

function providerFromModel(modelId: string): ProviderId {
  if (modelId.startsWith("ollama:")) return "ollama";
  // All Gemini variants plus unknown fallback.
  return "gemini";
}

/** Strip the `ollama:` namespace prefix used in stored model IDs. */
function ollamaTag(modelId: string): string {
  return modelId.replace(/^ollama:/, "");
}

/**
 * Fetches models from the local Ollama server. Re-runs whenever `baseUrl`
 * changes or `refresh()` is called. Errors are surfaced rather than thrown
 * so the UI can prompt the user to start Ollama / fix the URL.
 */
function useOllamaModels(baseUrl: string | undefined, enabled: boolean) {
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchModels = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const list = await api.listOllamaModels(baseUrl);
      setModels(list);
    } catch (e) {
      setError(typeof e === "string" ? e : (e as Error)?.message ?? "Failed to reach Ollama");
      setModels([]);
    } finally {
      setLoading(false);
    }
  }, [baseUrl, enabled]);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  return { models, loading, error, refresh: fetchModels };
}

function isConfigured(s: AppSettings, p: ProviderId): boolean {
  switch (p) {
    case "gemini":
      return s.hasGeminiKey;
    case "ollama":
      return !!s.ollamaBaseUrl;
  }
}

export function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const { theme, setTheme } = useTheme();
  const [displayName, setDisplayName] = useState("");
  const [organisation, setOrganisation] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    api.getSettings().then((s) => {
      setSettings(s);
      setDisplayName(s.displayName ?? "");
      setOrganisation(s.organisation ?? "");
    });
  }, []);

  const reload = async () => {
    const s = await api.getSettings();
    setSettings(s);
  };

  const activeProvider = useMemo(() => {
    if (!settings) return PROVIDERS[0];
    const id = providerFromModel(settings.defaultMainModel);
    return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
  }, [settings]);

  const otherProviders = useMemo(
    () => PROVIDERS.filter((p) => p.id !== activeProvider.id),
    [activeProvider],
  );

  // Pull live model list from Ollama whenever the URL changes. Always enabled
  // so "Other providers" can show a count even before the user expands the row.
  const ollama = useOllamaModels(settings?.ollamaBaseUrl, !!settings);

  if (!settings) return null;

  const activeIsConfigured = isConfigured(settings, activeProvider.id);

  // Auto-save profile fields on blur.
  const saveProfile = async (patch: { displayName?: string; organisation?: string }) => {
    await api.updateSettings(patch);
    reload();
  };

  // Model selection within the active provider.
  const selectMainModel = async (value: string) => {
    await api.updateSettings({ defaultMainModel: value });
    reload();
  };

  // Make a provider primary by setting its first model as defaultMainModel.
  const makePrimary = async (p: ProviderDef) => {
    let firstValue: string | undefined;
    if (p.id === "ollama") {
      firstValue = ollama.models[0] ? `ollama:${ollama.models[0].name}` : undefined;
    } else {
      firstValue = p.models[0]?.value;
    }
    if (!firstValue) return;
    await api.updateSettings({ defaultMainModel: firstValue });
    reload();
  };

  return (
    <div className="max-w-[720px] mx-auto px-6 py-10 pb-20 animate-fade-in">
      {/* Page header */}
      <h1
        className="font-display text-ink mb-2"
        style={{ fontSize: 40, fontWeight: 400, letterSpacing: "-0.8px", lineHeight: 1.1 }}
      >
        Settings
      </h1>
      <p className="text-body text-[14px] max-w-lg mb-12">
        Local-first by design. Documents and API keys stay on your machine.
      </p>

      {/* ───────── Current model ───────── */}
      <SectionHeading>Current model</SectionHeading>
      <ActiveProviderCard
        provider={activeProvider}
        configured={activeIsConfigured}
        activeModel={settings.defaultMainModel}
        onSelectModel={selectMainModel}
        settings={settings}
        onAfterSaveKey={reload}
        ollama={ollama}
      />

      {/* ───────── Other providers ───────── */}
      <SectionHeading>Other providers</SectionHeading>
      <div className="rounded-md border border-hairline-soft overflow-hidden">
        {otherProviders.map((p, i) => (
          <ProviderRow
            key={p.id}
            provider={p}
            settings={settings}
            isLast={i === otherProviders.length - 1}
            onAfterSaveKey={reload}
            onMakePrimary={() => makePrimary(p)}
            ollama={ollama}
          />
        ))}
      </div>

      {/* ───────── Advanced routing ───────── */}
      <SectionHeading>Advanced</SectionHeading>
      <button
        onClick={() => setAdvancedOpen((v) => !v)}
        className="w-full flex items-center gap-2 py-2 text-left text-[13px] text-ink hover:text-accent-blue transition-colors"
      >
        {advancedOpen ? (
          <ChevronDown className="w-3.5 h-3.5 text-muted" strokeWidth={1.5} />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-muted" strokeWidth={1.5} />
        )}
        Use different models for different tasks
      </button>
      {advancedOpen && (
        <div className="mt-2 rounded-md border border-hairline-soft p-4 space-y-3">
          <ModelRoutingRow
            label="Chat & document analysis"
            value={settings.defaultMainModel}
            onChange={(v) => api.updateSettings({ defaultMainModel: v }).then(reload)}
            ollamaModels={ollama.models}
          />
          <ModelRoutingRow
            label="Tabular extraction"
            value={settings.defaultTabularModel}
            onChange={(v) => api.updateSettings({ defaultTabularModel: v }).then(reload)}
            ollamaModels={ollama.models}
          />
          <ModelRoutingRow
            label="Chat titles & memory"
            value={settings.defaultTitleModel}
            onChange={(v) => api.updateSettings({ defaultTitleModel: v }).then(reload)}
            ollamaModels={ollama.models}
          />
        </div>
      )}

      {/* ───────── Profile ───────── */}
      <SectionHeading>Profile</SectionHeading>
      <div className="rounded-md border border-hairline-soft p-5 space-y-4">
        <InlineRow
          label="Your name"
          hint="Used in the greeting."
        >
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            onBlur={() => saveProfile({ displayName })}
            placeholder="e.g. Sarah"
            className="w-56 px-3 py-1.5 rounded-md border border-hairline bg-canvas text-[13px] text-ink placeholder:text-muted-soft focus:outline-none focus:border-accent-blue"
          />
        </InlineRow>
        <InlineRow label="Organisation">
          <input
            value={organisation}
            onChange={(e) => setOrganisation(e.target.value)}
            onBlur={() => saveProfile({ organisation })}
            placeholder="e.g. Smith & Partners"
            className="w-56 px-3 py-1.5 rounded-md border border-hairline bg-canvas text-[13px] text-ink placeholder:text-muted-soft focus:outline-none focus:border-accent-blue"
          />
        </InlineRow>
      </div>

      {/* ───────── Appearance ───────── */}
      <SectionHeading>Appearance</SectionHeading>
      <div className="rounded-md border border-hairline-soft p-5">
        <InlineRow label="Theme">
          <div className="flex items-center bg-surface-strong rounded-full p-0.5">
            <ThemePill active={theme === "light"} onClick={() => setTheme("light")} label="Light">
              <Sun className="w-3 h-3" strokeWidth={2} />
            </ThemePill>
            <ThemePill active={theme === "system"} onClick={() => setTheme("system")} label="System">
              <span className="text-[9px] font-bold">A</span>
            </ThemePill>
            <ThemePill active={theme === "dark"} onClick={() => setTheme("dark")} label="Dark">
              <Moon className="w-3 h-3" strokeWidth={2} />
            </ThemePill>
          </div>
        </InlineRow>
      </div>

      {/* ───────── About ───────── */}
      <SectionHeading>About</SectionHeading>
      <div className="rounded-md border border-hairline-soft p-5 space-y-3 text-[13px]">
        <InlineRow label="Version">
          <span className="text-body font-mono">v0.1.0</span>
        </InlineRow>
        <InlineRow label="Data directory">
          <span className="text-body font-mono text-[12px] truncate max-w-[280px]">
            ~/.holmes
          </span>
        </InlineRow>
        <InlineRow label="Source">
          <a
            href="https://github.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-accent-blue hover:text-primary-active underline underline-offset-2"
          >
            GitHub <ExternalLink className="w-3 h-3" strokeWidth={1.5} />
          </a>
        </InlineRow>
      </div>
    </div>
  );
}

/* ───────── Subcomponents ───────── */

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-10 mb-3 pb-2 border-b border-hairline-soft">
      <p className="mono-label">{children}</p>
    </div>
  );
}

function InlineRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6">
      <div className="min-w-0">
        <p className="text-[13px] text-ink">{label}</p>
        {hint && <p className="text-[11px] text-muted-soft mt-0.5">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function ThemePill({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`flex items-center justify-center w-7 h-7 rounded-full transition-all ${
        active ? "bg-canvas shadow-sm text-ink" : "text-muted-soft hover:text-muted"
      }`}
    >
      {children}
    </button>
  );
}

/* ───────── Active provider card (hero) ───────── */

function ActiveProviderCard({
  provider,
  configured,
  activeModel,
  onSelectModel,
  settings,
  onAfterSaveKey,
  ollama,
}: {
  provider: ProviderDef;
  configured: boolean;
  activeModel: string;
  onSelectModel: (v: string) => void;
  settings: AppSettings;
  onAfterSaveKey: () => void;
  ollama: ReturnType<typeof useOllamaModels>;
}) {
  const [configuring, setConfiguring] = useState(false);

  // For Ollama we use the live list; for hosted providers, the static one.
  const renderedModels: ModelDef[] =
    provider.id === "ollama"
      ? ollama.models.map((m) => ({
          value: `ollama:${m.name}`,
          label: m.name,
          description: m.size ? `${formatBytes(m.size)} · local` : "Local model",
        }))
      : provider.models;

  return (
    <div className="rounded-md border border-hairline bg-canvas p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="w-4 h-4 text-accent-blue" strokeWidth={1.5} />
            <p className="mono-label-sm">Connected</p>
            {!configured && (
              <span className="text-[10px] text-error font-medium uppercase tracking-wider">
                Key missing
              </span>
            )}
          </div>
          <h2
            className="font-display text-ink mb-1"
            style={{ fontSize: 28, fontWeight: 500, letterSpacing: "-0.4px", lineHeight: 1.1 }}
          >
            {provider.name}
          </h2>
          <p className="text-[13px] text-muted leading-relaxed">{provider.tagline}</p>
        </div>
      </div>

      {provider.isLocal && (
        <div className="mt-6 pt-5 border-t border-hairline-soft">
          <OllamaUrlField settings={settings} onSaved={onAfterSaveKey} />
        </div>
      )}

      <div className="mt-6 pt-5 border-t border-hairline-soft">
        <div className="flex items-center justify-between mb-3">
          <p className="mono-label-sm">Active model</p>
          {provider.id === "ollama" && (
            <button
              onClick={ollama.refresh}
              disabled={ollama.loading}
              className="inline-flex items-center gap-1 text-[11px] text-muted hover:text-ink disabled:opacity-50"
              title="Refresh models from Ollama"
            >
              <RefreshCw
                className={`w-3 h-3 ${ollama.loading ? "animate-spin" : ""}`}
                strokeWidth={1.5}
              />
              Refresh
            </button>
          )}
        </div>

        {provider.id === "ollama" && ollama.error && (
          <OllamaError error={ollama.error} />
        )}
        {provider.id === "ollama" && !ollama.error && ollama.models.length === 0 && (
          <OllamaEmpty loading={ollama.loading} />
        )}

        {renderedModels.length > 0 && (
          <div className="flex flex-col gap-2">
            {renderedModels.map((m) => {
              const active = m.value === activeModel;
              return (
                <button
                  key={m.value}
                  onClick={() => onSelectModel(m.value)}
                  className={`text-left p-3 rounded-md border transition-colors ${
                    active
                      ? "border-ink bg-canvas-soft"
                      : "border-hairline-soft hover:border-hairline-strong"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] text-ink font-medium truncate">{m.label}</p>
                      <p className="text-[11px] text-muted-soft mt-0.5">{m.description}</p>
                    </div>
                    <div
                      className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                        active ? "border-ink bg-ink" : "border-hairline-strong"
                      }`}
                    >
                      {active && <Check className="w-2.5 h-2.5 text-on-primary" strokeWidth={3} />}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {!configured && !configuring && !provider.isLocal && (
          <button
            onClick={() => setConfiguring(true)}
            className="mt-4 inline-flex items-center gap-1.5 text-[12px] text-accent-blue hover:text-primary-active underline underline-offset-2"
          >
            Add {provider.name} API key
          </button>
        )}

        {configured && !provider.isLocal && (
          <p className="mt-4 text-[11px] text-muted-soft">
            API key stored locally. Switch provider below to use a different model family.
          </p>
        )}

        {configuring && !provider.isLocal && (
          <div className="mt-4">
            <KeyForm
              provider={provider}
              onSaved={() => {
                setConfiguring(false);
                onAfterSaveKey();
              }}
              onCancel={() => setConfiguring(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
}

function OllamaError({ error }: { error: string }) {
  return (
    <div className="rounded-md border border-hairline-soft bg-surface-strong p-3 text-[12px] text-muted mb-3">
      <p className="text-ink font-medium mb-1">Can't reach Ollama</p>
      <p className="text-[11.5px] leading-relaxed">{error}</p>
      <p className="text-[11.5px] leading-relaxed mt-1.5">
        Make sure Ollama is running and pull a model with{" "}
        <span className="font-mono text-[11px]">ollama pull llama3.2</span>.
      </p>
    </div>
  );
}

function OllamaEmpty({ loading }: { loading: boolean }) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[12px] text-muted py-3">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Loading installed models…
      </div>
    );
  }
  return (
    <div className="rounded-md border border-hairline-soft bg-surface-strong p-3 text-[12px] text-muted mb-3">
      <p className="text-ink font-medium mb-1">No models installed</p>
      <p className="text-[11.5px] leading-relaxed">
        Pull one with <span className="font-mono text-[11px]">ollama pull llama3.2</span>, then refresh.
      </p>
    </div>
  );
}

/* ───────── Other providers row (collapsible) ───────── */

function ProviderRow({
  provider,
  settings,
  isLast,
  onAfterSaveKey,
  onMakePrimary,
  ollama,
}: {
  provider: ProviderDef;
  settings: AppSettings;
  isLast: boolean;
  onAfterSaveKey: () => void;
  onMakePrimary: () => void;
  ollama: ReturnType<typeof useOllamaModels>;
}) {
  const [open, setOpen] = useState(false);
  const configured = isConfigured(settings, provider.id);

  return (
    <div className={isLast ? "" : "border-b border-hairline-soft"}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-canvas-soft transition-colors"
      >
        <div className="w-9 h-9 rounded-md bg-surface-strong border border-hairline-soft flex items-center justify-center shrink-0">
          {provider.isLocal ? (
            <Cpu className="w-4 h-4 text-ink" strokeWidth={1.5} />
          ) : (
            <Sparkles className="w-4 h-4 text-ink" strokeWidth={1.5} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <p className="text-[13px] text-ink font-medium">{provider.name}</p>
            {provider.comingSoon && (
              <span className="text-[9px] text-muted-soft uppercase tracking-wider font-medium">
                Preview
              </span>
            )}
            {provider.id === "ollama" && configured && ollama.models.length > 0 && (
              <span className="text-[10px] text-muted-soft">
                {ollama.models.length} model{ollama.models.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
          <p className="text-[11.5px] text-muted-soft truncate">{provider.tagline}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {configured ? (
            <>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-surface-wash-green text-success text-[10px] font-medium rounded-full">
                <Check className="w-2.5 h-2.5" strokeWidth={2.5} /> Configured
              </span>
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  onMakePrimary();
                }}
                className="text-[11px] text-accent-blue hover:text-primary-active underline underline-offset-2 cursor-pointer"
              >
                Make primary
              </span>
            </>
          ) : (
            <span className="text-[11px] text-muted">
              {provider.isLocal ? "Configure" : "Add key"}
            </span>
          )}
          {open ? (
            <ChevronDown className="w-4 h-4 text-muted-soft" strokeWidth={1.5} />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-soft" strokeWidth={1.5} />
          )}
        </div>
      </button>
      {open && (
        <div className="px-5 pb-5 bg-canvas-soft border-t border-hairline-soft">
          <div className="pt-4 space-y-4">
            {provider.isLocal ? (
              <>
                <OllamaUrlField settings={settings} onSaved={onAfterSaveKey} />
                <OllamaPickerInRow
                  ollama={ollama}
                  activeModel={settings.defaultMainModel}
                  onSelect={async (value) => {
                    await api.updateSettings({ defaultMainModel: value });
                    onAfterSaveKey();
                  }}
                />
              </>
            ) : (
              <KeyForm
                provider={provider}
                onSaved={() => {
                  onAfterSaveKey();
                  setOpen(false);
                }}
                onCancel={() => setOpen(false)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function OllamaPickerInRow({
  ollama,
  activeModel,
  onSelect,
}: {
  ollama: ReturnType<typeof useOllamaModels>;
  activeModel: string;
  onSelect: (value: string) => void;
}) {
  const isOllamaActive = activeModel.startsWith("ollama:");
  const currentTag = isOllamaActive ? ollamaTag(activeModel) : "";

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="mono-label-sm">Installed models</p>
        <button
          onClick={ollama.refresh}
          disabled={ollama.loading}
          className="inline-flex items-center gap-1 text-[11px] text-muted hover:text-ink disabled:opacity-50"
        >
          <RefreshCw
            className={`w-3 h-3 ${ollama.loading ? "animate-spin" : ""}`}
            strokeWidth={1.5}
          />
          Refresh
        </button>
      </div>

      {ollama.error && <OllamaError error={ollama.error} />}
      {!ollama.error && ollama.models.length === 0 && (
        <OllamaEmpty loading={ollama.loading} />
      )}

      {ollama.models.length > 0 && (
        <select
          value={currentTag}
          onChange={(e) => onSelect(`ollama:${e.target.value}`)}
          className="w-full rounded-md border border-hairline bg-canvas px-2.5 py-1.5 text-[12px] text-ink focus:outline-none focus:border-accent-blue"
        >
          {!isOllamaActive && <option value="">Select a model…</option>}
          {ollama.models.map((m) => (
            <option key={m.name} value={m.name}>
              {m.name}
              {m.size ? ` · ${formatBytes(m.size)}` : ""}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

/* ───────── Shared field components ───────── */

function KeyForm({
  provider,
  onSaved,
  onCancel,
}: {
  provider: ProviderDef;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    if (!value.trim()) return;
    setSaving(true);
    // Only Gemini is wired as a hosted provider right now. Ollama uses
    // OllamaUrlField (URL, not key). If more hosted providers return,
    // add the corresponding patch branches here.
    const patch = provider.id === "gemini" ? { geminiApiKey: value.trim() } : {};
    await api.updateSettings(patch);
    setSaving(false);
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onSaved();
    }, 600);
  };

  return (
    <div>
      <p className="text-[11px] text-muted-soft mb-2">
        Stored locally in{" "}
        <span className="font-mono text-muted">~/.holmes_keys.json</span>. Never
        transmitted except to {provider.name}.
      </p>
      <div className="flex items-stretch gap-2">
        <div className="flex-1 relative">
          <input
            type={show ? "text" : "password"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={provider.keyPlaceholder ?? "API key"}
            autoFocus
            className="w-full px-3 py-2 pr-10 rounded-md border border-hairline bg-canvas text-[13px] text-ink placeholder:text-muted-soft focus:outline-none focus:border-accent-blue"
          />
          <button
            onClick={() => setShow(!show)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink transition-colors"
          >
            {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        </div>
        <button
          onClick={handleSave}
          disabled={!value.trim() || saving}
          className="px-4 py-2 text-[12px] font-medium text-on-primary bg-primary rounded-full hover:bg-primary-active disabled:opacity-40 transition-colors flex items-center gap-1.5"
        >
          {saving ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : saved ? (
            <Check className="w-3.5 h-3.5" />
          ) : null}
          {saved ? "Saved" : "Save key"}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-2 text-[12px] text-muted hover:text-ink rounded-md hover:bg-surface-strong transition-colors"
        >
          Cancel
        </button>
      </div>
      {provider.keyHelpUrl && (
        <a
          href={provider.keyHelpUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-[11px] text-accent-blue hover:text-primary-active underline underline-offset-2"
        >
          Get a {provider.name} API key <ExternalLink className="w-2.5 h-2.5" strokeWidth={1.5} />
        </a>
      )}
    </div>
  );
}

function OllamaUrlField({
  settings,
  onSaved,
}: {
  settings: AppSettings;
  onSaved: () => void;
}) {
  const [url, setUrl] = useState(settings.ollamaBaseUrl);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    await api.updateSettings({ ollamaBaseUrl: url });
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
    onSaved();
  };

  return (
    <div>
      <p className="text-[11px] text-muted-soft mb-2">
        Point Holmes at your local Ollama server. Default: <span className="font-mono">http://localhost:11434</span>
      </p>
      <div className="flex items-center gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={save}
          placeholder="http://localhost:11434"
          className="flex-1 px-3 py-2 rounded-md border border-hairline bg-canvas text-[13px] text-ink placeholder:text-muted-soft focus:outline-none focus:border-accent-blue"
        />
        {saved && (
          <span className="inline-flex items-center gap-1 text-[11px] text-success">
            <Check className="w-3 h-3" strokeWidth={2.5} /> Saved
          </span>
        )}
      </div>
    </div>
  );
}

/* ───────── Advanced routing row ───────── */

function ModelRoutingRow({
  label,
  value,
  onChange,
  ollamaModels,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  ollamaModels: OllamaModel[];
}) {
  // Flatten all models across providers, plus any live Ollama models found.
  const allModels = PROVIDERS.flatMap((p) => {
    if (p.id === "ollama") {
      return ollamaModels.map((m) => ({
        value: `ollama:${m.name}`,
        label: `${p.name} · ${m.name}`,
      }));
    }
    return p.models.map((m) => ({ value: m.value, label: `${p.name} · ${m.label}` }));
  });

  // Make sure the currently-saved value is selectable even if not in the list
  // (e.g. saved an Ollama model that has since been removed locally).
  const hasCurrent = allModels.some((m) => m.value === value);

  return (
    <div className="flex items-center justify-between gap-4">
      <p className="text-[12.5px] text-ink">{label}</p>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-hairline bg-canvas px-2.5 py-1.5 text-[12px] text-ink focus:outline-none focus:border-accent-blue min-w-[220px]"
      >
        {!hasCurrent && (
          <option value={value}>{value} (unavailable)</option>
        )}
        {allModels.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
    </div>
  );
}
