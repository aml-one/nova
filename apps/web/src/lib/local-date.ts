/** Calendar day in the user's local timezone (YYYY-MM-DD). */
export function localCalendarDateKeyFromInstant(isoOrTimestamp: string): string {
  const t = Date.parse(isoOrTimestamp);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function groupByLocalCalendarDate<T extends { createdAt: string }>(items: T[]): Record<string, T[]> {
  const acc: Record<string, T[]> = {};
  for (const item of items) {
    const key = localCalendarDateKeyFromInstant(item.createdAt);
    if (!key) continue;
    (acc[key] ??= []).push(item);
  }
  for (const k of Object.keys(acc)) {
    acc[k].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }
  return acc;
}

/** Readable section title for a local YYYY-MM-DD key. */
export function formatLocalDayHeading(ymd: string): string {
  const parts = ymd.split("-").map((p) => Number(p));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return ymd;
  const [y, m, d] = parts;
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime())) return ymd;
  return dt.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "short", day: "numeric" });
}
