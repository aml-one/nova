const ZONES: Array<{ key: string; label: string; iana: string }> = [
  { key: "greece", label: "Greece / Nova host (Athens)", iana: "Europe/Athens" },
  { key: "london", label: "London", iana: "Europe/London" },
  { key: "hungary", label: "Hungary (Budapest)", iana: "Europe/Budapest" },
  { key: "miami", label: "Miami (US Eastern)", iana: "America/New_York" },
  { key: "china", label: "China (Shanghai)", iana: "Asia/Shanghai" }
];

/** User asked for the bundled world clock sheet (no shell). */
export function detectWorldClocksIntent(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t.length > 400) return false;
  const asksTime =
    /\b(what'?s?\s+the\s+time|what\s+time|current\s+time|world\s+clock|time\s+in)\b/.test(t) ||
    /\btime\b.*\b(in|for|at)\b/.test(t);
  if (!asksTime) return false;
  const hits =
    /\b(greece|athens|europe\/athens|london|uk|budapest|hungary|miami|china|shanghai|beijing|eastern)\b/i.test(
      t
    ) || /\b(all|everywhere|each)\b.*\b(time|zone|clock)\b/i.test(t) || /\btime\s+zones?\b/i.test(t);
  return hits || /\bnova\b.*\btime\b/i.test(t);
}

export function formatWorldClocks(now = new Date()): string {
  const lines = ZONES.map((z) => {
    const date = now.toLocaleDateString("en-US", {
      timeZone: z.iana,
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric"
    });
    const time = now.toLocaleTimeString("en-US", {
      timeZone: z.iana,
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true
    });
    return `• ${z.label}: ${date}, ${time}`;
  });
  return ["Here are the clocks I track for you:", ...lines].join("\n");
}
