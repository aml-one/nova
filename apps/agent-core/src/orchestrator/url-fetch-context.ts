/**
 * Decide when to auto-fetch a pasted http(s) URL so the model can answer from page text
 * (without relying on Perplexica).
 */

const URL_IN_TEXT = /https?:\/\/[^\s\])>"']+/gi;

function stripAngleQuotes(s: string): string {
  return s.replace(/^[\s<(['"`]+/, "").replace(/[\s>)'"\]]+$/, "");
}

/** First URL-like substring in `text`, or undefined. */
export function extractHttpUrlsFromMessage(text: string): string[] {
  const matches = text.match(URL_IN_TEXT);
  if (!matches?.length) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of matches) {
    const u = stripAngleQuotes(raw.trim());
    if (!u.startsWith("http://") && !u.startsWith("https://")) continue;
    const key = u.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(u);
  }
  return out;
}

/** User explicitly asked to load a URL (slash command). */
export function extractUrlFromSlashFetchCommand(text: string): string | undefined {
  const t = text.trim();
  const lower = t.toLowerCase();
  if (lower.startsWith("/fetch ") || lower.startsWith("/url ")) {
    const rest = t.replace(/^\/(fetch|url)\s+/i, "").trim();
    const first = rest.split(/\s+/)[0];
    return first ? stripAngleQuotes(first) : undefined;
  }
  return undefined;
}

/**
 * Auto-fetch when the user clearly wants Nova to read a page, or pasted a link with little else,
 * or uses common “here’s the page” phrasing.
 */
export function shouldAutoFetchUrlFromMessage(text: string): boolean {
  const urls = extractHttpUrlsFromMessage(text);
  if (urls.length === 0) return false;
  if (extractUrlFromSlashFetchCommand(text)) return true;

  const lower = text.toLowerCase();
  if (
    /\b(read|fetch|open|load|pull|retrieve|grab)\s+(this\s+)?(page|url|link|site|website)\b/i.test(text) ||
    /\b(check\s+(it\s+)?out|look\s+at\s+(this\s+)?(page|link|url)|visit\s+(this\s+)?(page|link|url))\b/i.test(lower) ||
    /\b((here'?s|here\s+is)\s+the\s+(page|link|url)|the\s+page\s+for|paste(d)?\s+(a\s+)?link)\b/i.test(lower) ||
    /\b(imdb\.com|wikipedia\.org|rottentomatoes\.com|metacritic\.com)\b/i.test(lower)
  ) {
    return true;
  }

  const cleaned = text.replace(/\s+/g, " ").trim();
  for (const u of urls) {
    if (cleaned === u || cleaned === `(${u})` || cleaned === `<${u}>`) {
      return true;
    }
    const without = cleaned.split(u).join("").replace(/[\s:.,;()\-–—]+$/g, "").trim();
    if (without.length <= 14 && urls.length === 1) {
      return true;
    }
  }

  if (urls.length === 1 && cleaned.length <= 220 && !/`/.test(text)) {
    const nonUrl = cleaned.split(urls[0]!).join("").replace(/[\s:.,;()\-–—]+$/g, "").trim();
    if (nonUrl.length < 90) {
      return true;
    }
  }

  return false;
}

export function pickUrlToAutoFetch(text: string): string | undefined {
  const cmd = extractUrlFromSlashFetchCommand(text);
  if (cmd) return cmd;
  if (!shouldAutoFetchUrlFromMessage(text)) return undefined;
  return extractHttpUrlsFromMessage(text)[0];
}
