import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: "hsl(var(--surface) / <alpha-value>)",
        surface2: "hsl(var(--surface-2) / <alpha-value>)",
        text: "hsl(var(--text) / <alpha-value>)",
        muted: "hsl(var(--muted) / <alpha-value>)",
        border: "hsl(var(--border) / <alpha-value>)",
        pastelBlue: "hsl(var(--pastel-blue) / <alpha-value>)",
        pastelOrange: "hsl(var(--pastel-orange) / <alpha-value>)",
        pastelPink: "hsl(var(--pastel-pink) / <alpha-value>)",
        pastelGreen: "hsl(var(--pastel-green) / <alpha-value>)",
        pastelRed: "hsl(var(--pastel-red) / <alpha-value>)",
        pastelYellow: "hsl(var(--pastel-yellow) / <alpha-value>)",
        pastelPurple: "hsl(var(--pastel-purple) / <alpha-value>)"
      },
      borderRadius: {
        ui: "5px"
      }
    }
  }
};

export default config;
