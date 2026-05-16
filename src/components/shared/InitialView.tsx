import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Scale } from "lucide-react";
import { api } from "@/lib/tauri";
import { pickGreeting } from "@/lib/greetings";

/**
 * InitialView — the Holmes glyph parts from center while the "Hi, {name}"
 * greeting slides in. Ported from Mike's `InitialView`; restyled to match
 * Cohere's restrained editorial surface — the display text is monumental
 * but not decorated with gradient orbs. The glyph sits inside a neutral
 * near-black ring so the composition carries contrast without color fills.
 */
const ICON_SIZE = 56;
const GAP = 20;

export function InitialView() {
  const [name, setName] = useState<string>("there");
  const [loaded, setLoaded] = useState(false);
  const [iconOffset, setIconOffset] = useState(0);
  const [textOffset, setTextOffset] = useState(0);
  const textRef = useRef<HTMLHeadingElement>(null);

  // Pick one greeting per mount. Time/day aware but otherwise random, so
  // the same user sees "Good morning" in the morning, "Happy Friday" on
  // Fridays, and a varied set of classics otherwise. Static once chosen.
  const greeting = useMemo(() => pickGreeting(), []);

  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        const n = s.displayName?.trim();
        if (n) setName(n);
      })
      .catch(() => {
        /* stay with default */
      });
  }, []);

  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const h1Width = el.offsetWidth;
    setIconOffset((h1Width + GAP) / 2);
    setTextOffset((ICON_SIZE + GAP) / 2);
    // Recompute when either the greeting or the name changes so longer
    // salutations ("Burning the midnight oil, …") still measure correctly.
  }, [name, greeting]);

  useEffect(() => {
    if (!iconOffset) return;
    const t = setTimeout(() => setLoaded(true), 120);
    return () => clearTimeout(t);
  }, [iconOffset]);

  return (
    <div className="relative flex items-center justify-center w-full h-[96px]">
      {/* Holmes glyph: starts centered, slides left.
         Near-black ring over white canvas — Cohere's high-contrast rhythm. */}
      <div
        className="absolute flex items-center justify-center"
        style={{
          left: "50%",
          width: ICON_SIZE,
          height: ICON_SIZE,
          transform: loaded
            ? `translateX(calc(-50% - ${iconOffset}px))`
            : `translateX(-50%)`,
          transition: "transform 900ms cubic-bezier(0.25, 0.46, 0.45, 0.94)",
        }}
      >
        <div className="w-full h-full rounded-full bg-surface-dark flex items-center justify-center">
          <Scale className="w-7 h-7 text-on-dark" strokeWidth={1.5} />
        </div>
      </div>

      {/* Greeting: starts centered, slides right. */}
      <h1
        ref={textRef}
        className="absolute font-display text-ink whitespace-nowrap"
        style={{
          fontSize: 56,
          fontWeight: 400,
          letterSpacing: "-1.6px",
          lineHeight: 1,
          left: "50%",
          transform: loaded
            ? `translateX(calc(-50% + ${textOffset}px))`
            : `translateX(-50%)`,
          opacity: loaded ? 1 : 0,
          transition:
            "transform 900ms cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 700ms ease-out 250ms",
        }}
      >
        {greeting}, {name}
      </h1>
    </div>
  );
}
