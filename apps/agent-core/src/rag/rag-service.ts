import { randomUUID } from "node:crypto";
import { getDatabase } from "../storage/sqlite.js";

type RagMatch = {
  path: string;
  score: number;
  snippet: string;
};

export class RagService {
  async indexDocument(path: string, content: string): Promise<void> {
    const embedding = computeEmbedding(content);
    const db = getDatabase();
    db.prepare("INSERT INTO documents (id, path, content, embedding) VALUES (?, ?, ?, ?)").run(
      randomUUID(),
      path,
      content,
      JSON.stringify(embedding)
    );
  }

  async query(query: string): Promise<RagMatch[]> {
    const queryEmbedding = computeEmbedding(query);
    const db = getDatabase();
    const rows = db
      .prepare("SELECT path, content, embedding FROM documents ORDER BY created_at DESC LIMIT 200")
      .all() as Array<{ path: string; content: string; embedding: string }>;
    return rows
      .map((row) => {
        const vector = parseVector(row.embedding);
        return {
          path: row.path,
          score: cosineSimilarity(queryEmbedding, vector),
          snippet: row.content.slice(0, 240)
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }
}

function computeEmbedding(text: string): number[] {
  const vec = new Array(16).fill(0);
  for (let i = 0; i < text.length; i += 1) {
    vec[i % vec.length] += text.charCodeAt(i);
  }
  const norm = Math.sqrt(vec.reduce((acc, v) => acc + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

function parseVector(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw) as number[];
    return parsed;
  } catch {
    return new Array(16).fill(0);
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb) || 1;
  return dot / denom;
}
