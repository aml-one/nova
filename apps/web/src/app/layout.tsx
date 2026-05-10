import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ThemeProvider } from "../components/theme-provider";
import { ChromeLayout } from "../components/chrome-layout";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nova Agent Platform",
  description: "Local-first autonomous agent platform"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="h-full overflow-hidden" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var v=localStorage.getItem('nova:text-scale');if(v==='normal'||v==='medium'||v==='big'){document.documentElement.setAttribute('data-text-scale',v);}else{document.documentElement.setAttribute('data-text-scale','normal');}}catch(e){document.documentElement.setAttribute('data-text-scale','normal');}})();"
          }}
        />
      </head>
      <body className="flex h-full min-h-0 flex-col overflow-hidden">
        <ThemeProvider>
          <div className="flex min-h-0 flex-1 flex-col">
            <ChromeLayout>{children}</ChromeLayout>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
