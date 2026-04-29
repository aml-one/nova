import type { MemoryFact } from "./long-term-store.js";

export function retrieveRelevantFacts(facts: MemoryFact[], query: string): MemoryFact[] {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 2);
  return [...facts]
    .map((fact) => {
      const hay = fact.content.toLowerCase();
      const score = terms.reduce((acc, term) => acc + (hay.includes(term) ? 1 : 0), 0);
      return { fact, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((item) => item.fact);
}
