import { useEffect, useState } from "react";

type Theme = "light" | "dark" | "system";

function getSystemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  const resolved = theme === "system" ? getSystemTheme() : theme;
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem("holmes-theme") as Theme | null;
    return stored ?? "system";
  });

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem("holmes-theme", theme);
  }, [theme]);

  // Listen for system preference changes when in "system" mode.
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  return { theme, setTheme: setThemeState };
}

// Apply on initial load (before React hydrates) so there's no flash.
const stored = localStorage.getItem("holmes-theme") as Theme | null;
applyTheme(stored ?? "system");
