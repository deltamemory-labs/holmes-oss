import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";

const appWindow = getCurrentWindow();

/** Rough runtime platform detection — good enough to pick chrome. */
function detectIsMac(): boolean {
  if (typeof navigator === "undefined") return false;
  // navigator.platform is deprecated but still reliable for coarse OS split.
  const ua = navigator.userAgent || "";
  const platform = (navigator as Navigator & { platform?: string }).platform || "";
  return /Mac/i.test(platform) || /Mac OS X|Macintosh/i.test(ua);
}

/**
 * Custom titlebar.
 *  - On macOS: native traffic lights render over the webview (configured at
 *    window creation via `titleBarStyle: Overlay` + `trafficLightPosition`).
 *    We reserve ~76px on the left so content doesn't collide with them, and
 *    suppress the Windows-style min/max/close buttons.
 *  - On Windows / Linux: chromeless window, so we paint the full strip
 *    with minimize / maximize / close controls.
 *
 * The strip itself is `-webkit-app-region: drag` so the user can grab any
 * empty region to move the window. Double-clicking the empty strip toggles
 * maximize, matching both Windows and macOS native behavior.
 */
export function Titlebar() {
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    setIsMac(detectIsMac());
  }, []);

  return (
    <div
      onDoubleClick={(e) => {
        // Ignore double-clicks that originated on buttons — we only want
        // the empty region to toggle maximize.
        if ((e.target as HTMLElement).closest("button")) return;
        appWindow.toggleMaximize().catch(() => {});
      }}
      className={`h-9 flex items-center justify-between bg-canvas border-b border-hairline-soft titlebar-drag select-none shrink-0 ${
        isMac ? "pl-[84px]" : "pl-3"
      }`}
    >
      {/* Left spacer — empty so the strip stays a clean drag surface. */}
      <div className="flex-1" />

      {!isMac && (
        <div className="flex titlebar-no-drag">
          <button
            onClick={() => appWindow.minimize()}
            aria-label="Minimize"
            className="w-11 h-9 flex items-center justify-center text-muted hover:bg-hairline-soft transition-colors"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => appWindow.toggleMaximize()}
            aria-label="Maximize"
            className="w-11 h-9 flex items-center justify-center text-muted hover:bg-hairline-soft transition-colors"
          >
            <Square className="w-3 h-3" />
          </button>
          <button
            onClick={() => appWindow.close()}
            aria-label="Close"
            className="w-11 h-9 flex items-center justify-center text-muted hover:bg-error hover:text-on-primary transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
