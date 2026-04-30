"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Button } from "./ui/button";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  const isDark = theme === "dark";
  return (
    <Button
      type="button"
      tone="purple"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="text-xs"
    >
      {isDark ? "Light" : "Dark"} Theme
    </Button>
  );
}
