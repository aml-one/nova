/**
 * Decide when Nova should call the Perplexica web-search skill before the main model,
 * without relying on a single magic phrase.
 */

export type ResolvePerplexicaResult = {
  /** Search query sent to Perplexica (usually the full user message). */
  query?: string;
  /**
   * When true, the user clearly wanted live web research or verification; if the skill
   * is off, Nova should explain that instead of silently falling back to the base model.
   */
  insistedWeb: boolean;
};

function trimmedOrEmpty(text: string): string {
  return text.trim();
}

/** True when the user clearly wants live web research (phrases + /web + /search). */
export function detectExplicitInternetSearchRequest(text: string): boolean {
  const t = trimmedOrEmpty(text);
  if (!t) return false;
  const lower = t.toLowerCase();
  if (lower.startsWith("/web ") || lower.startsWith("/search ")) return true;
  return (
    /\b(search (the )?internet|internet search|search online|online search|look (it|this|that) up online|find (it|this) online)\b/i.test(
      t
    ) ||
    /\b(google|duckduckgo|ddg)\s+(it|this|that|for)\b/i.test(lower) ||
    /\b(use|using)\s+the\s+internet\b/i.test(lower) ||
    /\bplease\s+search\b/i.test(lower) ||
    /\bcan you search\b/i.test(lower) ||
    /\b(search the web|web search|browse the web)\b/i.test(lower)
  );
}

/** Pushback, verification, or doubt — user expects a fresh check, not a confident guess. */
function detectVerificationOrDoubtIntent(text: string): boolean {
  const lower = text.toLowerCase();
  if (
    /\b(check again|double[- ]check|verify(\s+(this|that|it))?\s*(online|on the (web|internet))?|re-?check|fact[- ]check|look (that|this|it) up(\s+online)?)\b/i.test(
      lower
    )
  ) {
    return true;
  }
  if (/\b(that|you|it)('s| is| was| are) wrong\b/i.test(lower) || /\b(incorrect|not accurate|hallucinat|made that up|invented that)\b/i.test(lower)) {
    return true;
  }
  if (/\b(are you sure|can you confirm|got a source|any sources|citation|prove it)\b/i.test(lower)) {
    return true;
  }
  if (/\b(search (for|the)|look (it )?up on)\b/i.test(lower) && /\b(web|internet|google|online)\b/i.test(lower)) {
    return true;
  }
  return false;
}

function detectHardPerplexicaPhrases(text: string): boolean {
  // Omit bare "latest/current news" here — `detectSoftCurrentEventsQuestion` handles those with insistedWeb: false.
  return /\b(search the web|search the internet|internet search|web search|look (it|this|that) up|find online|browse web|search online|latest updates|what happened today)\b/i.test(
    text
  );
}

/** Softer “time-sensitive public info” cue: still search when the skill is on, but do not scold if it is off. */
function detectSoftCurrentEventsQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  const hasNewsCue = /\b(news|headline|story|article|report|breaking|update|happening)\b/i.test(lower);
  const timeCue = /\b(current|latest|today|now|recent)\b/i.test(trimmed);
  const asks = /\b(what|who|when|where|why|how)\b/i.test(trimmed);
  if (!timeCue || !asks) return false;
  if (trimmed.includes("?")) return true;
  return hasNewsCue;
}

/**
 * Web-only heuristics for external facts that models often hallucinate (IDs, ratings, weather, scores).
 * Kept narrow to avoid searching on every casual question.
 */
function detectExternalPublicFactHeuristic(text: string, channel: string): boolean {
  if (channel !== "web") return false;
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 360) return false;
  const lower = trimmed.toLowerCase();

  if (/\btt\d{6,}\b/i.test(trimmed)) return true;
  if (/\bimdb\b/i.test(lower)) return true;
  if (/\b(rotten tomatoes|metacritic|box office mojo)\b/i.test(lower)) return true;
  if (/\b(who (directed|wrote|produced)|release date|rating|reviews? (for|of))\b/i.test(lower)) return true;
  if (/\b(weather (forecast|today|tomorrow)|temperature (in|at|for))\b/i.test(lower)) return true;
  if (/\b(stock price|share price|nasdaq|nyse)\b/i.test(lower) && /\b(of|for)\b/i.test(lower)) return true;
  if (/\b(latest|breaking) news\b/i.test(lower)) return true;
  if (/\b(nfl|nba|mlb|nhl|uefa|f1|olympic)\b/i.test(lower) && /\b(score|won|winner|final|standings)\b/i.test(lower)) {
    return true;
  }
  return false;
}

/**
 * Strip /web and /search command prefixes (returns undefined if nothing left).
 */
function queryFromSlashCommand(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("/web ") || lower.startsWith("/search ")) {
    const q = trimmed.replace(/^\/(web|search)\s+/i, "").trim();
    return q || undefined;
  }
  return undefined;
}

export function resolvePerplexicaSearchQuery(text: string, channel: string): ResolvePerplexicaResult {
  const trimmed = trimmedOrEmpty(text);
  if (!trimmed) return { insistedWeb: false };

  const slashQ = queryFromSlashCommand(trimmed);
  if (slashQ !== undefined) {
    return { query: slashQ, insistedWeb: true };
  }

  if (detectExplicitInternetSearchRequest(trimmed)) {
    return { query: trimmed, insistedWeb: true };
  }

  if (detectVerificationOrDoubtIntent(trimmed)) {
    return { query: trimmed, insistedWeb: true };
  }

  if (detectHardPerplexicaPhrases(trimmed)) {
    return { query: trimmed, insistedWeb: true };
  }

  if (detectSoftCurrentEventsQuestion(trimmed)) {
    return { query: trimmed, insistedWeb: false };
  }

  if (detectExternalPublicFactHeuristic(trimmed, channel)) {
    return { query: trimmed, insistedWeb: false };
  }

  return { insistedWeb: false };
}
