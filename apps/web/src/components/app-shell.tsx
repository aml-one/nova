"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
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
  FaShareNodes,
  FaWindowRestore,
  FaScrewdriverWrench
} from "react-icons/fa6";
import { ThemeToggle } from "./theme-toggle";
import { TextScaleToggle } from "./text-scale-toggle";
import { EmotionBadge } from "./emotion-badge";
import { ShellHeaderExtrasProvider, useShellHeaderExtras } from "./shell-header-extras";
import { cn } from "../lib/cn";

type NavLink = { href: string; label: string; icon: IconType; subtitle: string };
const links: NavLink[] = [
  { href: "/", label: "Chat", icon: FaMessage, subtitle: "Main conversation and media chat with Nova." },
  { href: "/dashboard", label: "Dashboard", icon: FaChartLine, subtitle: "Run telemetry, latency, throughput, and cost overview." },
  { href: "/thoughts", label: "Thoughts", icon: FaFolderOpen, subtitle: "Live stream of internal thought events." },
  { href: "/debug", label: "Debug", icon: FaScrewdriverWrench, subtitle: "Agent runtime log tail and this tab’s console mirror." },
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
  {
    href: "/services",
    label: "Service UIs",
    icon: FaWindowRestore,
    subtitle: "Embed companion HTTP dashboards on other ports (same host as Nova — works over LAN)."
  },
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

function AppMainColumn({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { extras } = useShellHeaderExtras();
  const activeLink =
    pathname === "/settings" ? settingsLink : (links.find((link) => link.href === pathname) ?? links[0]);
  const chatHeaderMode = pathname === "/" && extras != null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <header className="sticky top-0 z-30 shrink-0 border-b bg-surface/90 backdrop-blur">
        <div className="flex items-center justify-between gap-2 px-4 py-2">
          <div className="min-w-0 flex-1">
            {chatHeaderMode ? (
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">{extras}</div>
            ) : (
              <>
                <div className="text-sm font-semibold">{activeLink.label}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">{activeLink.subtitle}</div>
              </>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <EmotionBadge />
          </div>
        </div>
      </header>
      <main
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col",
          pathname === "/" ? "min-h-0 overflow-hidden px-0 py-0" : "overflow-y-auto overflow-x-hidden px-4 py-6"
        )}
      >
        {children}
      </main>
      <footer
        className={cn(
          "shrink-0 text-[11px] text-muted",
          pathname === "/" ? "hidden" : "px-4 pb-4"
        )}
      />
    </div>
  );
}

/**
 * Sidebar open/closed state survives reloads, agent updates, and tab switches via localStorage.
 * SSR defaults to "collapsed" so the first paint matches; right after hydration we read the user's
 * preference and the existing `transition-all` on `<aside>` smoothly opens it if it was open before.
 * The preference is only written when the user actively toggles, so the initial read can never be
 * overwritten by a stale render.
 */
const NAV_COLLAPSED_STORAGE_KEY = "nova:nav-collapsed";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [navCollapsed, setNavCollapsed] = useState(true);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(NAV_COLLAPSED_STORAGE_KEY);
      if (stored === "false") {
        setNavCollapsed(false);
      } else if (stored === "true") {
        setNavCollapsed(true);
      }
    } catch {
      // localStorage unavailable (private mode, disabled storage); fall back to default collapsed.
    }
  }, []);

  // Cross-tab sync: if the user opens or closes the sidebar in another window of the same browser,
  // mirror it here so all tabs stay consistent.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== NAV_COLLAPSED_STORAGE_KEY || event.newValue === null) return;
      if (event.newValue === "false") setNavCollapsed(false);
      else if (event.newValue === "true") setNavCollapsed(true);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const toggleNavCollapsed = useCallback(() => {
    setNavCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(NAV_COLLAPSED_STORAGE_KEY, next ? "true" : "false");
      } catch {
        // Persistence is best-effort; UI state still flips even if storage is blocked.
      }
      return next;
    });
  }, []);

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-gradient-to-br from-surface via-surface to-surface2">
      <aside
        className={cn(
          "fixed left-0 top-0 z-40 h-screen border-r bg-surface/95 p-2 backdrop-blur transition-all",
          navCollapsed ? "w-14" : "w-56"
        )}
      >
        <div className={cn("mb-2 flex min-h-8 items-center gap-2", navCollapsed ? "justify-center" : "justify-between")}>
          {!navCollapsed ? (
            <h1 className="min-w-0 flex-1 text-3xl font-bold leading-8 tracking-tight text-text">Nova</h1>
          ) : null}
          <button
            type="button"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-ui border bg-surface2 text-[10px]"
            onClick={toggleNavCollapsed}
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
            {index === 1 || index === 8 || index === 13 || index === 16 ? <div className="my-2 h-px w-full bg-slate-300/40" /> : null}
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
            <TextScaleToggle compact={navCollapsed} />
            <ThemeToggle />
          </div>
          {!navCollapsed ? <div className="text-center text-[11px] text-muted">Made by AmL</div> : null}
        </div>
      </aside>
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
          navCollapsed ? "ml-14" : "ml-56"
        )}
      >
        <ShellHeaderExtrasProvider>
          <AppMainColumn>{children}</AppMainColumn>
        </ShellHeaderExtrasProvider>
      </div>
    </div>
  );
}
