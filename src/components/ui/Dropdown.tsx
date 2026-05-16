import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";

interface Option {
  value: string;
  label: string;
}

interface Props {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  label?: string;
  /** Compact mode for inline use in toolbars / chat input bars. */
  compact?: boolean;
}

/**
 * Dropdown select. Styled for Cohere's restrained UI: 8px radius,
 * hairline borders, action-blue focus ring, mono-label for the optional
 * label. The compact variant (used in chat toolbar) drops the container
 * and renders inline.
 */
export function Dropdown({ value, options, onChange, label, compact }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div>
      {label && <p className="mono-label mb-1.5">{label}</p>}
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className={
            compact
              ? "flex items-center gap-1.5 rounded-md px-2 h-8 text-[12px] text-muted hover:bg-surface-strong hover:text-ink transition-colors"
              : "w-full flex items-center justify-between px-3 py-2 bg-canvas border border-hairline rounded-md text-[13px] text-ink hover:border-hairline-strong focus:outline-none focus:border-accent-blue transition-all duration-150"
          }
        >
          <span>{selected?.label ?? "Select"}</span>
          <ChevronDown className={`w-3 h-3 text-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
        </button>

        {open && (
          <div className="absolute z-50 bottom-full mb-1.5 left-0 min-w-[180px] bg-canvas border border-hairline rounded-md shadow-md overflow-hidden animate-slide-up">
            {options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onChange(opt.value); setOpen(false); }}
                className={`w-full flex items-center justify-between px-3 py-2 text-[12px] transition-colors duration-150 ${
                  opt.value === value
                    ? "bg-surface-strong text-ink"
                    : "text-body hover:bg-canvas-soft"
                }`}
              >
                <span>{opt.label}</span>
                {opt.value === value && <Check className="w-3 h-3 text-ink" strokeWidth={2.5} />}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
