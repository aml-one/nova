/**
 * Detects admin-style "tell &lt;Person&gt; to …" / "ask … that …" without requiring `/tell Person:`.
 * Conservative: skips slash-commands and blocklisted pseudo-names (single-token only).
 */
const RELAY_NAME_BLOCKLIST = new Set([
  "me",
  "us",
  "you",
  "them",
  "her",
  "him",
  "it",
  "we",
  "nova",
  "everyone",
  "someone",
  "everybody",
  "anyone",
  "nobody",
  "people",
  "myself",
  "yourself",
  "ourselves"
]);

function normalizeForRelayIntent(raw: string): string {
  let t = raw.trim();
  if (!t) return t;
  // "Nova, …" / "Hey Nova — …"
  // Strip vocative after "Nova" including em/en dash (— –) so "Hey Nova — tell …" works.
  t = t.replace(/^(?:(?:hey\s+)?nova[,.:;\s\u2013\u2014-]+)+/iu, "").trim();
  t = t.replace(/^(?:can you |could you |would you )\s*/i, "").trim();
  return t;
}

function tryParseTellOrAskToOrThat(t: string): { name: string; message: string } | undefined {
  const s = t.replace(/^please\s+/i, "").trim();
  // Prefer "tell X that …" first so "tell Bob that … moved to 3pm" does not treat "moved to" as the relay split.
  const m =
    s.match(/^(?:tell|ask)\s+([A-Za-z][A-Za-z0-9.'\s-]{0,120}?)\s+that\s+([\s\S]+)$/i) ??
    s.match(/^(?:tell|ask)\s+([A-Za-z][A-Za-z0-9.'\s-]{0,120}?)\s+to\s+([\s\S]+)$/i);
  if (!m?.[1] || !m?.[2]) return undefined;
  const name = m[1].trim().replace(/\s+/g, " ");
  const message = m[2].trim();
  if (name.length < 2 || name.length > 80 || !message) return undefined;
  const tokens = name.split(/\s+/).filter(Boolean);
  const first = tokens[0]?.toLowerCase() ?? "";
  if (!first || RELAY_NAME_BLOCKLIST.has(first)) {
    return undefined;
  }
  if (tokens.length === 1 && RELAY_NAME_BLOCKLIST.has(name.toLowerCase())) {
    return undefined;
  }
  return { name, message };
}

/**
 * When the user asks Nova to relay something to another person by name (natural language).
 * Does not match explicit `/tell` lines — those stay in `parseTellCommand`.
 */
export function parseNaturalLanguageRelayToPerson(text: string): { name: string; message: string } | undefined {
  const raw = text.trim();
  if (!raw) return undefined;
  if (/^\/\S/.test(raw)) return undefined;

  const t = normalizeForRelayIntent(raw);
  if (!t) return undefined;
  return tryParseTellOrAskToOrThat(t);
}
