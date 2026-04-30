"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { FaMoon, FaSun } from "react-icons/fa6";
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
      className="h-8 w-8 p-0"
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
    >
      {isDark ? <FaSun className="h-3.5 w-3.5" /> : <FaMoon className="h-3.5 w-3.5" />}
    </Button>
  );
}
