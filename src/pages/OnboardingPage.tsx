import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Scale,
  Key,
  FolderOpen,
  ArrowRight,
  Check,
  Loader2,
  Shield,
  Cpu,
} from "lucide-react";
import { Titlebar } from "@/components/shared/Titlebar";
import { api } from "@/lib/tauri";

const steps = ["Welcome", "API Key", "Get Started"];

/**
 * Three-step onboarding. Cohere's hero pages open on a single oversized
 * typographic declaration over a white canvas, with photography or
 * abstract imagery carrying color. We follow that cadence — no gradient
 * orbs, no decorative fills; the brand glyph sits in a near-black ring,
 * primary CTAs use the 32px pill, progress uses a quiet dot rail.
 */
export function OnboardingPage() {
  const [step, setStep] = useState(0);
  const [apiKey, setApiKey] = useState("");
  const [validating, setValidating] = useState(false);
  const [validated, setValidated] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleValidate = async () => {
    if (!apiKey.trim()) return;
    setValidating(true);
    setError("");
    try {
      // Save the key first; we can validate later when provider layer is built
      await api.updateSettings({ geminiApiKey: apiKey.trim() });
      setValidated(true);
    } catch {
      setError("Failed to save key. Please try again.");
    }
    setValidating(false);
  };

  const handleFinish = async () => {
    await api.updateSettings({ onboardingComplete: true });
    navigate({ to: "/" });
  };

  return (
    <div className="h-screen flex flex-col bg-canvas">
      <Titlebar />
      <div className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-lg px-8">
          {/* Progress */}
          <div className="flex items-center gap-2 mb-14 justify-center">
            {steps.map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <div
                  className={`w-1.5 h-1.5 rounded-full transition-colors ${
                    i <= step ? "bg-primary" : "bg-hairline-strong"
                  }`}
                />
                {i < steps.length - 1 && (
                  <div
                    className={`w-10 h-px transition-colors ${
                      i < step ? "bg-primary" : "bg-hairline"
                    }`}
                  />
                )}
              </div>
            ))}
          </div>

          {/* Step 0: Welcome */}
          {step === 0 && (
            <div className="text-center">
              <div className="flex justify-center mb-7">
                <div className="w-16 h-16 rounded-full bg-surface-dark flex items-center justify-center">
                  <Scale className="w-8 h-8 text-on-dark" strokeWidth={1.5} />
                </div>
              </div>
              <h1
                className="font-display text-ink mb-4"
                style={{ fontSize: 56, fontWeight: 400, letterSpacing: "-1.6px", lineHeight: 1 }}
              >
                Holmes
              </h1>
              <p className="text-body text-base leading-relaxed max-w-sm mx-auto mb-10">
                The legal AI that remembers everything your firm has ever done.
                Local-first, private, open source.
              </p>

              <div className="grid grid-cols-2 gap-3 mb-10 max-w-sm mx-auto">
                <div className="flex items-start gap-2.5 p-4 rounded-md bg-canvas border border-hairline-soft text-left">
                  <Shield className="w-4 h-4 text-accent-blue mt-0.5 shrink-0" strokeWidth={1.5} />
                  <div>
                    <p className="mono-label-sm mb-0.5">Private</p>
                    <p className="text-[12px] text-body leading-snug">
                      Documents stay on your machine
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5 p-4 rounded-md bg-canvas border border-hairline-soft text-left">
                  <Cpu className="w-4 h-4 text-accent-coral mt-0.5 shrink-0" strokeWidth={1.5} />
                  <div>
                    <p className="mono-label-sm mb-0.5">Cross-matter</p>
                    <p className="text-[12px] text-body leading-snug">
                      Memory across all your deals
                    </p>
                  </div>
                </div>
              </div>

              <button
                onClick={() => setStep(1)}
                className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-on-primary text-sm font-medium rounded-full hover:bg-primary-active transition-all duration-200"
              >
                Get started
                <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>
          )}

          {/* Step 1: API Key */}
          {step === 1 && (
            <div>
              <div className="flex justify-center mb-6">
                <div className="w-12 h-12 rounded-md bg-surface-strong flex items-center justify-center border border-hairline-soft">
                  <Key className="w-5 h-5 text-ink" strokeWidth={1.5} />
                </div>
              </div>
              <h2
                className="font-display text-ink text-center mb-3"
                style={{ fontSize: 40, fontWeight: 400, letterSpacing: "-0.8px", lineHeight: 1.1 }}
              >
                Connect a model
              </h2>
              <p className="text-muted text-sm text-center mb-10">
                Paste your Gemini API key. The free tier is enough to get started.
              </p>

              <div className="space-y-3">
                <div className="relative">
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setValidated(false);
                      setError("");
                    }}
                    placeholder="AIza..."
                    className="w-full px-4 py-3 bg-canvas border border-hairline rounded-md text-sm text-ink placeholder:text-muted-soft focus:outline-none focus:border-accent-blue transition-colors"
                  />
                  {validated && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <Check className="w-4 h-4 text-success" strokeWidth={2} />
                    </div>
                  )}
                </div>

                {error && <p className="text-xs text-error">{error}</p>}

                <a
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block text-xs text-accent-blue hover:text-primary-active transition-colors underline underline-offset-2"
                >
                  Get a free Gemini API key
                </a>
              </div>

              <div className="flex items-center gap-3 mt-10">
                <button
                  onClick={() => setStep(0)}
                  className="px-4 py-2.5 text-sm text-muted hover:text-ink transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={validated ? () => setStep(2) : handleValidate}
                  disabled={!apiKey.trim() || validating}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 bg-primary text-on-primary text-sm font-medium rounded-full hover:bg-primary-active transition-colors disabled:bg-surface-strong disabled:text-muted-soft"
                >
                  {validating ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : validated ? (
                    <>
                      Continue
                      <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
                    </>
                  ) : (
                    "Save key"
                  )}
                </button>
              </div>

              <p className="text-[11px] text-muted-soft text-center mt-8">
                You can also use Ollama for fully local operation. Configure it
                later in Settings.
              </p>
            </div>
          )}

          {/* Step 2: Ready */}
          {step === 2 && (
            <div className="text-center">
              <div className="flex justify-center mb-6">
                <div className="w-12 h-12 rounded-md bg-surface-strong flex items-center justify-center border border-hairline-soft">
                  <FolderOpen className="w-5 h-5 text-ink" strokeWidth={1.5} />
                </div>
              </div>
              <h2
                className="font-display text-ink mb-3"
                style={{ fontSize: 40, fontWeight: 400, letterSpacing: "-0.8px", lineHeight: 1.1 }}
              >
                You're all set
              </h2>
              <p className="text-muted text-sm mb-10 max-w-xs mx-auto">
                Create a project, drop in your documents, and start asking
                questions. Holmes will remember everything.
              </p>

              <button
                onClick={handleFinish}
                className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-on-primary text-sm font-medium rounded-full hover:bg-primary-active transition-colors"
              >
                Open Holmes
                <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
