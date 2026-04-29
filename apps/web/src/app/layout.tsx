import type { Metadata } from "next";
import type { ReactNode } from "react";
import { EmotionBadge } from "../components/emotion-badge";

export const metadata: Metadata = {
  title: "Nova Agent Platform",
  description: "Local-first autonomous agent platform"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <EmotionBadge />
        {children}
      </body>
    </html>
  );
}
