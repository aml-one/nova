/**
 * Hard validation for improvement "Target file" paths: only repo-relative paths under
 * the autonomous safe roots, not on the deny list, and (for persisted/displayed targets)
 * must exist as a regular file on disk.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

/** Repo-relative prefixes (forward slashes, no leading slash) allowed for improvement targets. */
export const IMPROVEMENT_SAFE_ROOT_PREFIXES: ReadonlyArray<string> = [
  "apps/agent-core/src",
  "apps/web/src",
  "packages/sdk/src",
  "skills"
];

/**
 * Same deny semantics as the proposal worker — paths matching any pattern are never accepted.
 * Tested against normalised forward-slash repo-relative paths.
 */
export const IMPROVEMENT_TARGET_DENY_PATTERNS: ReadonlyArray<RegExp> = [
  /(^|\/)\.env(\.|$)/,
  /(^|\/)\.git(\/|$)/,
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)tmp(\/|$)/,
  /(^|\/)data(\/|$)/,
  /(^|\/)logs(\/|$)/,
  /(^|\/)scripts\/install-/,
  /(^|\/)scripts\/uninstall-/,
  /(^|\/)scripts\/start-local/,
  /(^|\/)apps\/agent-core\/src\/transport\/http-server\.ts$/,
  /(^|\/)apps\/agent-core\/src\/auth\//,
  /(^|\/)apps\/agent-core\/src\/security\//,
  /(^|\/)apps\/web\/src\/middleware\.ts$/,
  /(^|\/)apps\/web\/src\/middleware\.tsx$/,
  /(^|\/)apps\/web\/src\/lib\/secrets\.(ts|tsx)$/
];

export function isImprovementRepoPathDenied(relForward: string): boolean {
  return IMPROVEMENT_TARGET_DENY_PATTERNS.some((pattern) => pattern.test(relForward));
}

export function isImprovementPathUnderSafeRoots(
  relForward: string,
  safeRoots: ReadonlyArray<string> = IMPROVEMENT_SAFE_ROOT_PREFIXES
): boolean {
  return safeRoots.some((root) => relForward === root || relForward.startsWith(`${root}/`));
}

/**
 * Normalise a model-supplied path fragment to a repo-relative forward-slash path, or `undefined` if unsafe.
 */
export function normalizeProposedRepoRelativePath(raw: string): string | undefined {
  let s = raw.trim();
  if (!s) return undefined;
  s = s.replace(/^[`'"]+|[`'"]+$/g, "").trim();
  s = s.replace(/^file:\/\//i, "").trim();
  s = s.replace(/\\/g, "/");
  while (s.startsWith("./")) {
    s = s.slice(2);
  }
  if (/^[a-zA-Z]:\//.test(s) || s.startsWith("/")) {
    return undefined;
  }
  const parts = s.split("/").filter((p) => p.length > 0 && p !== ".");
  if (parts.some((p) => p === "..")) {
    return undefined;
  }
  if (parts.length < 2) {
    return undefined;
  }
  return parts.join("/");
}

/**
 * If `raw` resolves to an existing regular file under a safe root and not denied, returns canonical
 * repo-relative path (forward slashes). Otherwise `undefined`.
 */
export function canonicalRepoRelativePathIfExistingFile(
  raw: string,
  repoRoot: string,
  safeRoots: ReadonlyArray<string> = IMPROVEMENT_SAFE_ROOT_PREFIXES
): string | undefined {
  const rel = normalizeProposedRepoRelativePath(raw);
  if (!rel) return undefined;
  if (!isImprovementPathUnderSafeRoots(rel, safeRoots)) return undefined;
  if (isImprovementRepoPathDenied(rel)) return undefined;
  const absolute = resolve(repoRoot, ...rel.split("/"));
  try {
    if (!existsSync(absolute)) return undefined;
    const st = statSync(absolute);
    if (!st.isFile()) return undefined;
  } catch {
    return undefined;
  }
  return rel;
}

const HINT_STOPWORDS = new Set(
  "a an the and or but if in on at to for of as is was are were been be have has had do does did will would could should may might must not no yes with from into by about over under than then them their this that these those your our their its we you he she it one two all any each few more most other some such only own same so than too very just also back only even still such here there when what which who whom whose why how".split(
    /\s+/
  )
);

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const row = new Array<number>(n + 1);
  for (let j = 0; j <= n; j += 1) row[j] = j;
  for (let i = 1; i <= m; i += 1) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const tmp = row[j]!;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j - 1]! + 1, row[j]! + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[n]!;
}

function fileStemLower(name: string): string {
  const dot = name.lastIndexOf(".");
  return (dot > 0 ? name.slice(0, dot) : name).toLowerCase();
}

function extractHintTokens(hintText: string | undefined): string[] {
  if (!hintText?.trim()) return [];
  const raw = hintText.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) ?? [];
  const out: string[] = [];
  for (const w of raw) {
    if (HINT_STOPWORDS.has(w)) continue;
    out.push(w);
  }
  return Array.from(new Set(out));
}

function scoreStemAgainstHints(stem: string, tokens: string[]): number {
  if (!stem || tokens.length === 0) return 0;
  let score = 0;
  for (const t of tokens) {
    if (t.length < 4) continue;
    if (stem === t || stem.includes(t) || t.includes(stem)) {
      score += 1;
    }
  }
  return score;
}

/**
 * When the model names a plausible path (safe root, parent dir exists) but the file is missing,
 * try to map it to a single real file in that directory using:
 * 1) only file with the same extension;
 * 2) title/summary/why hint tokens matching one basename stem (unique best);
 * 3) unique closest Levenshtein match on basename among same-extension files (tight threshold).
 */
export function tryResolveImprovementTargetPath(
  raw: string,
  repoRoot: string,
  safeRoots: ReadonlyArray<string> = IMPROVEMENT_SAFE_ROOT_PREFIXES,
  hintText?: string
): string | undefined {
  const exact = canonicalRepoRelativePathIfExistingFile(raw, repoRoot, safeRoots);
  if (exact) return exact;

  const rel = normalizeProposedRepoRelativePath(raw);
  if (!rel || !isImprovementPathUnderSafeRoots(rel, safeRoots) || isImprovementRepoPathDenied(rel)) {
    return undefined;
  }

  const slash = rel.lastIndexOf("/");
  const parentRel = slash >= 0 ? rel.slice(0, slash) : "";
  const base = slash >= 0 ? rel.slice(slash + 1) : rel;
  if (!parentRel || !base) return undefined;

  const parentAbs = resolve(repoRoot, ...parentRel.split("/"));
  try {
    if (!existsSync(parentAbs) || !statSync(parentAbs).isDirectory()) return undefined;
  } catch {
    return undefined;
  }

  let names: string[];
  try {
    names = readdirSync(parentAbs, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name);
  } catch {
    return undefined;
  }

  const ext = base.includes(".") ? base.slice(base.lastIndexOf(".")).toLowerCase() : "";
  const pool = ext ? names.filter((n) => n.toLowerCase().endsWith(ext)) : names;
  if (pool.length === 0) return undefined;

  const wantedStem = fileStemLower(base);
  const shortLevThreshold = Math.max(2, Math.floor(Math.max(wantedStem.length, 4) * 0.34));

  if (pool.length === 1) {
    const onlyName = pool[0]!;
    const onlyStem = fileStemLower(onlyName);
    const tokensEarly = extractHintTokens(hintText);
    const hinted =
      tokensEarly.length > 0 && scoreStemAgainstHints(onlyStem, tokensEarly) > 0;
    const typo = levenshtein(wantedStem, onlyStem) <= shortLevThreshold;
    if (hinted || typo) {
      const candidate = `${parentRel}/${onlyName}`.replace(/\\/g, "/");
      return canonicalRepoRelativePathIfExistingFile(candidate, repoRoot, safeRoots);
    }
  }

  const tokens = extractHintTokens(hintText);
  if (tokens.length > 0) {
    const scored = pool
      .map((name) => ({ name, score: scoreStemAgainstHints(fileStemLower(name), tokens) }))
      .filter((row) => row.score > 0);
    if (scored.length > 0) {
      const maxScore = Math.max(...scored.map((row) => row.score));
      const winners = scored.filter((row) => row.score === maxScore);
      if (winners.length === 1) {
        const candidate = `${parentRel}/${winners[0]!.name}`.replace(/\\/g, "/");
        return canonicalRepoRelativePathIfExistingFile(candidate, repoRoot, safeRoots);
      }
    }
  }

  const threshold = shortLevThreshold;
  const scoredLev = pool.map((name) => ({
    name,
    d: levenshtein(wantedStem, fileStemLower(name))
  }));
  scoredLev.sort((a, b) => a.d - b.d);
  const top = scoredLev[0]!;
  if (top.d > threshold) return undefined;
  if (scoredLev.length > 1 && scoredLev[1]!.d <= top.d + 1) return undefined;
  const candidate = `${parentRel}/${top.name}`.replace(/\\/g, "/");
  return canonicalRepoRelativePathIfExistingFile(candidate, repoRoot, safeRoots);
}

export type SanitizeImprovementProposalDetailsOptions = {
  safeRoots?: ReadonlyArray<string>;
  /** Title, summary, or other proposal text used to pick a real file when the path is wrong but the directory matches. */
  hintText?: string;
};

/**
 * Strip or rewrite invalid `Target file:` lines so APIs never surface hallucinated paths.
 * Valid lines are rewritten to the canonical on-disk path when it differs only by normalisation.
 * When `hintText` is provided, may substitute a real file in the same directory (conservative heuristics).
 */
export function sanitizeImprovementProposalDetailsBody(
  details: string,
  repoRoot: string,
  safeRootsOrOpts?: ReadonlyArray<string> | SanitizeImprovementProposalDetailsOptions
): string {
  let safeRoots: ReadonlyArray<string> = IMPROVEMENT_SAFE_ROOT_PREFIXES;
  let hintText: string | undefined;
  if (Array.isArray(safeRootsOrOpts)) {
    safeRoots = safeRootsOrOpts;
  } else if (safeRootsOrOpts) {
    const o = safeRootsOrOpts as SanitizeImprovementProposalDetailsOptions;
    safeRoots = o.safeRoots ?? safeRoots;
    hintText = o.hintText;
  }
  const raw = details.trim();
  if (!raw) return details;
  const lines = raw.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    const m = line.match(/^(\s*)Target\s+file\s*:\s*(.+)$/i);
    if (m?.[2]) {
      const resolved = tryResolveImprovementTargetPath(m[2].trim(), repoRoot, safeRoots, hintText);
      if (resolved) {
        out.push(`${m[1] ?? ""}Target file: ${resolved}`);
      }
    } else {
      out.push(line);
    }
  }
  return out.join("\n").trimEnd();
}

/**
 * Last explicit `Target file:` line wins (matches how proposals are usually authored).
 */
export function extractExplicitTargetFileRaw(haystack: string): string | undefined {
  const matches = [...haystack.matchAll(/^\s*Target\s+file\s*:\s*(.+)$/gim)];
  if (matches.length === 0) return undefined;
  const last = matches[matches.length - 1]?.[1]?.trim();
  return last && last.length > 0 ? last : undefined;
}
