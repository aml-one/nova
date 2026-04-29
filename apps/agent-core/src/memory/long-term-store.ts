export type MemoryFact = {
  type: "fact" | "preference" | "summary";
  content: string;
};

export class LongTermStore {
  private readonly facts = new Map<string, MemoryFact[]>();

  add(userId: string, fact: MemoryFact): void {
    const existing = this.facts.get(userId) ?? [];
    this.facts.set(userId, [...existing, fact]);
  }

  list(userId: string): MemoryFact[] {
    return this.facts.get(userId) ?? [];
  }

  snapshot(): Record<string, MemoryFact[]> {
    return Object.fromEntries(this.facts.entries());
  }
}
