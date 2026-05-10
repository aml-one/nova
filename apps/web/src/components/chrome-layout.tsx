"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AppShell } from "./app-shell";

/**
 * Full-app chrome: main routes use the sidebar shell; `/kiosk` is a bare route for wall displays.
 */
export function ChromeLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/kiosk" || pathname?.startsWith("/kiosk/")) {
    return <>{children}</>;
  }
  return <AppShell>{children}</AppShell>;
}
