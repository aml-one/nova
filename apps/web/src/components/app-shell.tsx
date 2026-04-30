"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { ThemeToggle } from "./theme-toggle";
import { cn } from "../lib/cn";

const links = [
  { href: "/", label: "Chat", icon: "C" },
  { href: "/dashboard", label: "Dashboard", icon: "D" },
  { href: "/memory", label: "Memory", icon: "M" },
  { href: "/reports", label: "Reports", icon: "R" },
  { href: "/knowledge", label: "Knowledge", icon: "K" },
  { href: "/workflows", label: "Workflows", icon: "W" },
  { href: "/cameras", label: "Cameras", icon: "Cam" },
  { href: "/replay", label: "Replay", icon: "Re" },
  { href: "/sandbox", label: "Sandbox", icon: "S" },
  { href: "/rollout", label: "Rollout", icon: "Ro" },
  { href: "/voice", label: "Voice", icon: "V" },
  { href: "/ocr", label: "OCR", icon: "O" },
  { href: "/settings", label: "Settings", icon: "Set" },
  { href: "/lab", label: "Lab", icon: "L" },
  { href: "/learning", label: "Learning", icon: "Le" },
  { href: "/thoughts", label: "Thoughts", icon: "T" },
  { href: "/emotion", label: "Emotion", icon: "E" },
  { href: "/security", label: "Security", icon: "Sec" }
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [version, setVersion] = useState("...");
  const [installedAt, setInstalledAt] = useState<string | null>(null);
  const [navCollapsed, setNavCollapsed] = useState(false);

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/system/version");
      const data = (await response.json()) as { version?: string; installedAt?: string };
      if (response.ok) {
        setVersion(data.version ?? "0.0.0");
        setInstalledAt(data.installedAt ?? null);
      }
    })();
  }, []);

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
              <span className="inline-flex min-w-[22px] justify-center font-semibold">{link.icon}</span>
              {!navCollapsed ? <span>{link.label}</span> : null}
            </Link>
          ))}
        </nav>
      </aside>
      <header className={cn("sticky top-0 z-30 border-b bg-surface/90 backdrop-blur", navCollapsed ? "ml-14" : "ml-56")}>
        <div className="flex items-center justify-end gap-2 px-4 py-2">
          <span className="rounded-ui border bg-surface2 px-2 py-1 text-xs text-muted">v{version}</span>
          <span className="rounded-ui border bg-surface2 px-2 py-1 text-xs text-muted">
            Installed {installedAt ? new Date(installedAt).toLocaleDateString() : "-"}
          </span>
          <ThemeToggle />
        </div>
      </header>
      <main className={cn("px-4 py-6", navCollapsed ? "ml-14" : "ml-56")}>{children}</main>
      <footer className={cn("px-4 pb-4 text-[11px] text-muted", navCollapsed ? "ml-14" : "ml-56")}>Nova - Made by AmL</footer>
    </div>
  );
}
