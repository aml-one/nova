import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type LearningRecord = {
  id: string;
  at: string;
  category: "outcome" | "proposal" | "research" | "improvement" | "validation" | "error";
  proposal: string;
  accepted: boolean;
  result?: string;
  details?: Record<string, unknown>;
};

export class LearningLog {
  private readonly records: LearningRecord[] = [];
  private readonly storePath: string;

  constructor(storePath = resolve(process.cwd(), "data", "state", "learning-log.json")) {
    this.storePath = storePath;
    this.load();
  }

  append(
    proposal: string,
    accepted: boolean,
    result?: string,
    category: LearningRecord["category"] = "proposal",
    details?: Record<string, unknown>
  ): void {
    this.records.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
      category,
      proposal,
      accepted,
      result,
      details
    });
    this.persist();
  }

  getAll(): LearningRecord[] {
    return [...this.records];
  }

  getGroupedByDate(): Record<string, LearningRecord[]> {
    return this.records.reduce<Record<string, LearningRecord[]>>((acc, item) => {
      const key = item.at.slice(0, 10);
      const existing = acc[key] ?? [];
      existing.push(item);
      acc[key] = existing;
      return acc;
    }, {});
  }

  private load(): void {
    if (!existsSync(this.storePath)) {
      return;
    }
    try {
      const raw = readFileSync(this.storePath, "utf8");
      const parsed = JSON.parse(raw) as Array<Partial<LearningRecord>>;
      this.records.push(
        ...parsed.map((item) => ({
          id: item.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          at: item.at ?? new Date().toISOString(),
          category: item.category ?? "proposal",
          proposal: item.proposal ?? "unknown",
          accepted: item.accepted === true,
          result: item.result,
          details: item.details
        }))
      );
    } catch (error) {
      console.warn("failed to load learning log", error);
    }
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.storePath), { recursive: true });
      writeFileSync(this.storePath, JSON.stringify(this.records, null, 2), "utf8");
    } catch (error) {
      console.warn("failed to persist learning log", error);
    }
  }
}
