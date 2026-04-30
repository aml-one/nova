/**
 * SQLite CURRENT_TIMESTAMP / naive DATETIME values are UTC wall time without a timezone suffix.
 * Parsing "YYYY-MM-DD HH:MM:SS" as local time in JS is wrong for those values; normalize to ISO-8601 UTC.
 */
export function sqliteUtcDatetimeToIso(value: string): string {
  const v = value.trim();
  if (!v) return v;
  if (/^\d{4}-\d{2}-\d{2}T/.test(v)) {
    if (v.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(v)) return v;
    return `${v}Z`;
  }
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(\.\d+)?)$/.exec(v);
  if (m) {
    return `${m[1]}T${m[2]}Z`;
  }
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : v;
}
