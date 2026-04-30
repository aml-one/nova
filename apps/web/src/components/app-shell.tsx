"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { ThemeToggle } from "./theme-toggle";
import { cn } from "../lib/cn";

const links = [
  { href: "/", label: "Chat" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/memory", label: "Memory" },
  { href: "/reports", label: "Reports" },
  { href: "/knowledge", label: "Knowledge" },
  { href: "/workflows", label: "Workflows" },
  { href: "/cameras", label: "Cameras" },
  { href: "/replay", label: "Replay" },
  { href: "/sandbox", label: "Sandbox" },
  { href: "/rollout", label: "Rollout" },
  { href: "/voice", label: "Voice" },
  { href: "/ocr", label: "OCR" },
  { href: "/settings", label: "Settings" },
  { href: "/lab", label: "Lab" },
  { href: "/learning", label: "Learning" },
  { href: "/thoughts", label: "Thoughts" },
  { href: "/emotion", label: "Emotion" },
  { href: "/security", label: "Security" }
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [version, setVersion] = useState("...");
  const [installedAt, setInstalledAt] = useState<string | null>(null);

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
      <header className="sticky top-0 z-40 border-b bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-4">
            <div>
              <h1 className="text-lg font-semibold">Nova</h1>
              <p className="text-[11px] text-muted">Nova by AmL</p>
            </div>
            <nav className="flex flex-wrap gap-2">
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "rounded-ui border px-2 py-1 text-xs",
                    pathname === link.href ? "bg-pastelBlue border-blue-500/70 text-slate-900" : "bg-surface2"
                  )}
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-ui border bg-surface2 px-2 py-1 text-xs text-muted">v{version}</span>
            <span className="rounded-ui border bg-surface2 px-2 py-1 text-xs text-muted">
              Installed {installedAt ? new Date(installedAt).toLocaleDateString() : "-"}
            </span>
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      <footer className="mx-auto max-w-7xl px-4 pb-4 text-[11px] text-muted">Nova - Made by AmL</footer>
    </div>
  );
}
