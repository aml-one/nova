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
  FaMicrophone,
  FaRepeat,
  FaRobot,
  FaRoute,
  FaShieldHalved,
  FaSliders,
  FaTableList,
  FaTimeline,
  FaWandMagicSparkles,
  FaBookOpen
} from "react-icons/fa6";
import { ThemeToggle } from "./theme-toggle";
import { EmotionBadge } from "./emotion-badge";
import { cn } from "../lib/cn";

const links = [
  { href: "/", label: "Chat", icon: FaMessage, subtitle: "Main conversation and media chat with Nova." },
  { href: "/dashboard", label: "Dashboard", icon: FaChartLine, subtitle: "Run telemetry, latency, throughput, and cost overview." },
  { href: "/memory", label: "Memory", icon: FaDatabase, subtitle: "Pin and manage durable memory cards for Nova." },
  { href: "/reports", label: "Reports", icon: FaBookOpen, subtitle: "Weekly learning summaries and overnight digests." },
  { href: "/knowledge", label: "Knowledge", icon: FaRoute, subtitle: "Entity and relationship graph from long-term memory." },
  { href: "/workflows", label: "Workflows", icon: FaListCheck, subtitle: "Build if-this-then-that automations for Nova tasks." },
  { href: "/cameras", label: "Cameras", icon: FaCamera, subtitle: "Camera timeline events and live semantic alerts." },
  { href: "/replay", label: "Replay", icon: FaRepeat, subtitle: "Fork prior runs and continue alternate chat branches." },
  { href: "/sandbox", label: "Sandbox", icon: FaShieldHalved, subtitle: "Simulate risky commands before execution." },
  { href: "/rollout", label: "Rollout", icon: FaTimeline, subtitle: "Stage, checkpoint, and rollback settings changes." },
  { href: "/voice", label: "Voice", icon: FaMicrophone, subtitle: "Wake-word bridge and voice integration checks." },
  { href: "/ocr", label: "OCR", icon: FaTableList, subtitle: "Extract text and tables from local documents." },
  { href: "/skills", label: "Skills", icon: FaWandMagicSparkles, subtitle: "Browse loaded skills and their capabilities." },
  { href: "/settings", label: "Settings", icon: FaSliders, subtitle: "Configure providers, channels, safety, and UI." },
  { href: "/lab", label: "Lab", icon: FaFlask, subtitle: "Advanced experiments, policy tests, and diagnostics." },
  { href: "/learning", label: "Learning", icon: FaRobot, subtitle: "Self-improvement events and autonomous learning runs." },
  { href: "/thoughts", label: "Thoughts", icon: FaFolderOpen, subtitle: "Live stream of internal thought events." },
  { href: "/emotion", label: "Emotion", icon: FaHeart, subtitle: "Emotion timeline and state transitions." },
  { href: "/security", label: "Security", icon: FaLock, subtitle: "Security center actions, anomalies, and audit history." }
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [navCollapsed, setNavCollapsed] = useState(false);
  const activeLink = links.find((link) => link.href === pathname) ?? links[0];

  return (
    <div className="min-h-screen bg-gradient-to-br from-surface via-surface to-surface2">
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
            className="rounded-ui border bg-surface2 px-2 py-1 text-[10px]"
            onClick={() => setNavCollapsed((prev) => !prev)}
            title={navCollapsed ? "Expand menu" : "Collapse menu"}
          >
            {navCollapsed ? ">" : "<"}
          </button>
        </div>
        <nav className="space-y-1 overflow-y-auto">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "flex items-center gap-2 rounded-ui border text-xs",
                navCollapsed ? "h-8 w-8 justify-center" : "px-2 py-1.5",
                pathname === link.href ? "bg-pastelBlue border-blue-500/70 text-slate-900" : "bg-surface2"
              )}
              title={link.label}
            >
              <span className="inline-flex min-w-[22px] justify-center font-semibold">
                <link.icon className="h-3.5 w-3.5" />
              </span>
              {!navCollapsed ? <span>{link.label}</span> : null}
            </Link>
          ))}
        </nav>
      </aside>
      <header className={cn("sticky top-0 z-30 border-b bg-surface/90 backdrop-blur", navCollapsed ? "ml-14" : "ml-56")}>
        <div className="flex items-center justify-between gap-2 px-4 py-2">
          <div>
            <div className="text-sm font-semibold">{activeLink.label}</div>
            <div className="text-xs text-slate-500">{activeLink.subtitle}</div>
          </div>
          <div className="flex items-center gap-2">
            <EmotionBadge />
          <ThemeToggle />
          </div>
        </div>
      </header>
      <main className={cn("px-4 py-6", navCollapsed ? "ml-14" : "ml-56")}>{children}</main>
      <footer className={cn("px-4 pb-4 text-[11px] text-muted", navCollapsed ? "ml-14" : "ml-56")}>Nova - Made by AmL</footer>
    </div>
  );
}
