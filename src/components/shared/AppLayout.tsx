import { useState } from "react";
import { Outlet } from "@tanstack/react-router";
import { PanelLeftOpen } from "lucide-react";
import { AppSidebar } from "./AppSidebar";
import { Titlebar } from "./Titlebar";
import { CommandPalette } from "./CommandPalette";

/**
 * Shell layout. Cohere keeps the UI shell restrained — no decorative
 * gradient orbs or ambient chrome. Color and energy come from content
 * (photography, product mockups, coral taxonomy). The shell itself is
 * a white canvas with a single hairline separating the sidebar.
 */
export function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="flex flex-col h-screen bg-canvas">
      <Titlebar />
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div
          className={`h-full shrink-0 overflow-hidden transition-[width] duration-300 ease-in-out ${
            sidebarOpen ? "w-60" : "w-0"
          }`}
        >
          <div className="w-60 h-full min-w-[240px]">
            <AppSidebar onCollapse={() => setSidebarOpen(false)} />
          </div>
        </div>

        {/* Expand button when collapsed */}
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="absolute top-[48px] left-3 z-20 p-1.5 rounded-md text-muted hover:text-ink hover:bg-surface-strong transition-all animate-fade-in"
            title="Expand sidebar"
          >
            <PanelLeftOpen className="w-4 h-4" strokeWidth={1.5} />
          </button>
        )}

        <main className="flex-1 overflow-auto relative bg-canvas">
          <div className="relative z-10 h-full">
            <Outlet />
          </div>
        </main>
      </div>
      <CommandPalette />
    </div>
  );
}
