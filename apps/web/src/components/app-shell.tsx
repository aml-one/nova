"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { IconType } from "react-icons";
import {
  FaCamera,
  FaChartLine,
  FaDatabase,
  FaFlask,
  FaFolderOpen,
  FaHeart,
  FaListCheck,
  FaLock,
  FaMessage,
  FaRepeat,
  FaRobot,
  FaRoute,
  FaShieldHalved,
  FaSliders,
  FaTableList,
  FaTimeline,
  FaWandMagicSparkles,
  FaBookOpen,
  FaChevronLeft,
  FaChevronRight,
  FaShareNodes
} from "react-icons/fa6";
import { ThemeToggle } from "./theme-toggle";
import { TextScaleToggle } from "./text-scale-toggle";
import { EmotionBadge } from "./emotion-badge";
import { cn } from "../lib/cn";

type NavLink = { href: string; label: string; icon: IconType; subtitle: string };
const links: NavLink[] = [
  { href: "/", label: "Chat", icon: FaMessage, subtitle: "Main conversation and media chat with Nova." },
  { href: "/dashboard", label: "Dashboard", icon: FaChartLine, subtitle: "Run telemetry, latency, throughput, and cost overview." },
  { href: "/thoughts", label: "Thoughts", icon: FaFolderOpen, subtitle: "Live stream of internal thought events." },
  { href: "/emotion", label: "Emotion", icon: FaHeart, subtitle: "Emotion timeline and state transitions." },
  { href: "/memory", label: "Memory", icon: FaDatabase, subtitle: "Pin and manage durable memory cards for Nova." },
  { href: "/knowledge", label: "Knowledge", icon: FaRoute, subtitle: "Entity and relationship graph from long-term memory." },
  {
    href: "/identity-evolution",
    label: "Identity",
    icon: FaShareNodes,
    subtitle: "Read-only identity evolution timeline (persona, learning, backups)."
  },
  { href: "/reports", label: "Reports", icon: FaBookOpen, subtitle: "Weekly learning summaries and overnight digests." },
  { href: "/learning", label: "Learning", icon: FaRobot, subtitle: "Self-improvement events and autonomous learning runs." },
  { href: "/autonomy", label: "Autonomy", icon: FaRobot, subtitle: "Deep diagnostics for learning loops and independence health." },
  { href: "/endpoints", label: "Endpoints", icon: FaRoute, subtitle: "Browse and test available web/api endpoints for debugging." },
  { href: "/workflows", label: "Workflows", icon: FaListCheck, subtitle: "Build if-this-then-that automations for Nova tasks." },
  { href: "/replay", label: "Replay", icon: FaRepeat, subtitle: "Fork prior runs and continue alternate chat branches." },
  { href: "/cameras", label: "Camera Timeline", icon: FaCamera, subtitle: "Detection feed and recent camera events." },
  { href: "/camera-monitor", label: "Camera Monitor", icon: FaCamera, subtitle: "Per-camera controls, tests, snapshots, and detection timeline." },
  { href: "/sandbox", label: "Sandbox", icon: FaShieldHalved, subtitle: "Simulate risky commands before execution." },
  { href: "/rollout", label: "Rollout", icon: FaTimeline, subtitle: "Stage, checkpoint, and rollback settings changes." },
  { href: "/security", label: "Security", icon: FaLock, subtitle: "Security center actions, anomalies, and audit history." },
  { href: "/ocr", label: "OCR", icon: FaTableList, subtitle: "Extract text and tables from local documents." },
  { href: "/skills", label: "Skills", icon: FaWandMagicSparkles, subtitle: "Browse loaded skills and their capabilities." },
  { href: "/lab", label: "Lab", icon: FaFlask, subtitle: "Advanced experiments, policy tests, and diagnostics." }
] as const;

const settingsLink: NavLink = {
  href: "/settings",
  label: "Settings",
  icon: FaSliders,
  subtitle: "Configure providers, channels, safety, voice (tab), and UI."
};

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [navCollapsed, setNavCollapsed] = useState(false);
  const activeLink =
    pathname === "/settings" ? settingsLink : (links.find((link) => link.href === pathname) ?? links[0]);

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-gradient-to-br from-surface via-surface to-surface2">
      <aside
        className={cn(
          "fixed left-0 top-0 z-40 h-screen border-r bg-surface/95 p-2 backdrop-blur transition-all",
          navCollapsed ? "w-14" : "w-56"
        )}
      >
        <div className={cn("mb-2 flex items-center", navCollapsed ? "justify-center" : "justify-between")}>
          {!navCollapsed ? (
            <div>
              <h1 className="text-sm font-semibold">Nova</h1>
              <p className="text-[10px] text-muted">Nova by AmL</p>
            </div>
          ) : null}
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-ui border bg-surface2 text-[10px]"
            onClick={() => setNavCollapsed((prev) => !prev)}
            title={navCollapsed ? "Expand menu" : "Collapse menu"}
          >
            {navCollapsed ? <FaChevronRight className="h-3 w-3" /> : <FaChevronLeft className="h-3 w-3" />}
          </button>
        </div>
        <nav className="space-y-1 overflow-y-auto">
          {links.map((link, index) => (
            <div key={link.href}>
            <Link
              href={link.href}
              className={cn(
                "flex items-center gap-2 rounded-ui border text-xs",
                navCollapsed ? "mx-auto h-8 w-8 justify-center" : "px-2 py-1.5",
                pathname === link.href ? "bg-pastelBlue border-blue-500/70 text-slate-900" : "bg-surface2"
              )}
              title={link.label}
            >
              <span className="inline-flex min-w-[22px] justify-center font-semibold">
                <link.icon className="h-3.5 w-3.5" />
              </span>
              {!navCollapsed ? <span>{link.label}</span> : null}
            </Link>
            {index === 1 || index === 8 || index === 12 || index === 15 ? <div className="my-2 h-px w-full bg-slate-300/40" /> : null}
            </div>
          ))}
          <div className="mt-2 h-px w-full bg-slate-300/40" />
          <div className="pt-2">
            <Link
              href={settingsLink.href}
              className={cn(
                "flex items-center gap-2 rounded-ui border text-xs",
                navCollapsed ? "mx-auto h-8 w-8 justify-center" : "px-2 py-1.5",
                pathname === "/settings" ? "bg-pastelBlue border-blue-500/70 text-slate-900" : "bg-surface2"
              )}
              title={settingsLink.label}
            >
              <span className="inline-flex min-w-[22px] justify-center font-semibold">
                <settingsLink.icon className="h-3.5 w-3.5" />
              </span>
              {!navCollapsed ? <span>{settingsLink.label}</span> : null}
            </Link>
          </div>
        </nav>
        <div className={cn("absolute bottom-2 left-2 right-2", navCollapsed ? "" : "")}>
          <div className={cn("mb-1 flex items-center gap-1", navCollapsed ? "justify-center" : "justify-end")}>
            <TextScaleToggle />
            <ThemeToggle />
          </div>
          {!navCollapsed ? <div className="text-center text-[11px] text-muted">Made by AmL</div> : null}
        </div>
      </aside>
      <div className={cn("flex min-h-0 flex-1 flex-col", navCollapsed ? "ml-14" : "ml-56")}>
        <header className="sticky top-0 z-30 shrink-0 border-b bg-surface/90 backdrop-blur">
          <div className="flex items-center justify-between gap-2 px-4 py-2">
            <div>
              <div className="text-sm font-semibold">{activeLink.label}</div>
              <div className="text-xs text-slate-500">{activeLink.subtitle}</div>
            </div>
            <div className="flex items-center gap-2">
              <EmotionBadge />
            </div>
          </div>
        </header>
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-6">{children}</main>
        <footer className="shrink-0 px-4 pb-4 text-[11px] text-muted" />
      </div>
    </div>
  );
}
