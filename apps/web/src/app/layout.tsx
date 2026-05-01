import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ThemeProvider } from "../components/theme-provider";
import { AppShell } from "../components/app-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nova Agent Platform",
  description: "Local-first autonomous agent platform"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <AppShell>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
