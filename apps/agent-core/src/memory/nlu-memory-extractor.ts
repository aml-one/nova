import type { MemoryFact } from "./long-term-store.js";

type MemoryJson = {
  memories: Array<{ type: MemoryFact["type"]; content: string }>;
};

export function extractMemoriesWithNlu(text: string): MemoryFact[] {
  const heuristic = extractHeuristics(text);
  const jsonCandidate = parseInlineJson(text);
  if (jsonCandidate.length > 0) {
    return [...heuristic, ...jsonCandidate];
  }
  return heuristic;
}

function extractHeuristics(text: string): MemoryFact[] {
  const output: MemoryFact[] = [];
  const preference = text.match(/(?:i prefer|my favorite is|i like)\s+(.+)$/i);
  if (preference?.[1]) {
    output.push({ type: "preference", content: preference[1].trim() });
  }
  const fact = text.match(/(?:remember that|note that|important:)\s+(.+)$/i);
  if (fact?.[1]) {
    output.push({ type: "fact", content: fact[1].trim() });
  }
  const summary = text.match(/(?:summary:)\s+(.+)$/i);
  if (summary?.[1]) {
    output.push({ type: "summary", content: summary[1].trim() });
  }
  return output;
}

function parseInlineJson(text: string): MemoryFact[] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return [];
  }
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as MemoryJson;
    return (parsed.memories ?? [])
      .filter((item) => (item.type === "fact" || item.type === "preference" || item.type === "summary") && item.content)
      .map((item) => ({ type: item.type, content: item.content.trim() }));
  } catch {
    return [];
  }
}
