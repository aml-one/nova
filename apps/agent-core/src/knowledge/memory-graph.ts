/**
 * Lightweight “knowledge graph” from long-term memory text: token co-occurrence.
 * Filters common English / UI noise so the UI is not dominated by words like “dark mode”.
 */

export type MemoryGraphNode = { id: string; label: string; count: number };
export type MemoryGraphEdge = { source: string; target: string; weight: number };

const STOPWORDS = new Set(
  `
about after again also always another any anything anyway arent because been before being below between both
button call came can cant click come could dark day days did didnt does doesnt doing done down each else
even ever every few first for from get gets getting give go going gone good got great had has have having
her here hes high him his how however http https if into its just keep kind know last left let light like
little long look lot made make many maybe might mode more most much must name near need never next nice
none nor not note now off often once only onto other ought our out over own page part per place please put
quite rather really right said same seem seen several shall she should show since some something soon still
such sure take than that the their them then there these they thing things this those though three through
too took turn two under until unto very want wants was way well went were what when where whether which
while who whole whose why will willing wish with within without wont would yes yet you your youre
nova user chat text message reply thread using used uses
`
    .trim()
    .split(/\s+/)
    .filter(Boolean)
);

function tokenizeMemoryText(raw: string): string[] {
  const text = raw.toLowerCase();
  const matches = text.match(/\b[a-z][a-z0-9_-]{4,}\b/g) ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of matches) {
    if (STOPWORDS.has(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= 14) break;
  }
  return out;
}

export function buildMemoryKnowledgeGraph(rows: Array<{ content?: string }>): {
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
} {
  const nodeMap = new Map<string, MemoryGraphNode>();
  const edgeMap = new Map<string, MemoryGraphEdge>();

  for (const row of rows) {
    const tokens = tokenizeMemoryText(row.content ?? "");
    for (const token of tokens) {
      const n = nodeMap.get(token) ?? { id: token, label: token, count: 0 };
      n.count += 1;
      nodeMap.set(token, n);
    }
    const cap = Math.min(tokens.length, 9);
    for (let i = 0; i < cap; i++) {
      for (let j = i + 1; j < cap; j++) {
        const a = tokens[i];
        const b = tokens[j];
        if (!a || !b || a === b) continue;
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        const edge = edgeMap.get(key) ?? { source: a < b ? a : b, target: a < b ? b : a, weight: 0 };
        edge.weight += 1;
        edgeMap.set(key, edge);
      }
    }
  }

  return {
    nodes: [...nodeMap.values()].sort((a, b) => b.count - a.count).slice(0, 150),
    edges: [...edgeMap.values()].sort((a, b) => b.weight - a.weight).slice(0, 300)
  };
}
