import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type PendingQuestion = {
  id: string;
  userId: string;
  question: string;
  topic?: string;
  createdAt: string;
};

type CuriosityState = {
  pendingQuestions: PendingQuestion[];
  skillGenerationByDate: Record<string, number>;
};

const DEFAULT_STATE: CuriosityState = {
  pendingQuestions: [],
  skillGenerationByDate: {}
};

export class CuriosityStore {
  private state: CuriosityState = DEFAULT_STATE;

  constructor(private readonly storePath = resolve(process.cwd(), "data", "state", "curiosity-store.json")) {
    this.load();
  }

  enqueueQuestions(userId: string, questions: Array<{ question: string; topic?: string }>): void {
    const now = new Date().toISOString();
    const normalized = questions
      .map((item) => item.question.trim())
      .filter((item) => item.length > 0)
      .slice(0, 10);
    if (normalized.length === 0) return;
    const existingSet = new Set(
      this.state.pendingQuestions
        .filter((item) => item.userId === userId)
        .map((item) => item.question.toLowerCase())
    );
    for (const [index, question] of normalized.entries()) {
      if (existingSet.has(question.toLowerCase())) continue;
      this.state.pendingQuestions.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        userId,
        question,
        topic: questions[index]?.topic?.trim() || undefined,
        createdAt: now
      });
    }
    // Keep queue bounded to avoid unbounded growth.
    if (this.state.pendingQuestions.length > 200) {
      this.state.pendingQuestions = this.state.pendingQuestions.slice(-200);
    }
    this.persist();
  }

  consumeQuestions(userId: string, limit = 2): PendingQuestion[] {
    const max = Math.max(1, Math.min(5, Math.floor(limit)));
    const mine = this.state.pendingQuestions
      .filter((item) => item.userId === userId || item.userId === "global")
      .slice(0, max);
    if (mine.length === 0) {
      return [];
    }
    const ids = new Set(mine.map((item) => item.id));
    this.state.pendingQuestions = this.state.pendingQuestions.filter((item) => !ids.has(item.id));
    this.persist();
    return mine;
  }

  getGeneratedSkillCountForDate(dateKey: string): number {
    return Math.max(0, Number(this.state.skillGenerationByDate[dateKey] ?? 0));
  }

  markSkillGenerated(dateKey: string): number {
    const next = this.getGeneratedSkillCountForDate(dateKey) + 1;
    this.state.skillGenerationByDate[dateKey] = next;
    this.persist();
    return next;
  }

  getStats(): { pendingQuestions: number; skillGenerationByDate: Record<string, number> } {
    return {
      pendingQuestions: this.state.pendingQuestions.length,
      skillGenerationByDate: { ...this.state.skillGenerationByDate }
    };
  }

  private load(): void {
    if (!existsSync(this.storePath)) {
      return;
    }
    try {
      const parsed = JSON.parse(readFileSync(this.storePath, "utf8")) as Partial<CuriosityState>;
      const pending = Array.isArray(parsed.pendingQuestions)
        ? parsed.pendingQuestions
            .filter((item): item is PendingQuestion => Boolean(item?.id) && Boolean(item?.userId) && Boolean(item?.question))
            .map((item) => ({
              id: String(item.id),
              userId: String(item.userId),
              question: String(item.question),
              topic: item.topic ? String(item.topic) : undefined,
              createdAt: item.createdAt ? String(item.createdAt) : new Date().toISOString()
            }))
        : [];
      const byDate =
        parsed.skillGenerationByDate && typeof parsed.skillGenerationByDate === "object"
          ? Object.fromEntries(
              Object.entries(parsed.skillGenerationByDate).map(([key, value]) => [key, Math.max(0, Number(value ?? 0))])
            )
          : {};
      this.state = {
        pendingQuestions: pending,
        skillGenerationByDate: byDate
      };
    } catch (error) {
      console.warn("failed to load curiosity store", error);
      this.state = { ...DEFAULT_STATE };
    }
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.storePath), { recursive: true });
      writeFileSync(this.storePath, JSON.stringify(this.state, null, 2), "utf8");
    } catch (error) {
      console.warn("failed to persist curiosity store", error);
    }
  }
}

