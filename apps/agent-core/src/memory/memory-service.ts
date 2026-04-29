import type { ChatMessage } from "@nova/sdk/provider";
import type { MemoryFact } from "./long-term-store.js";
import { retrieveRelevantFacts } from "./retrieval.js";
import { MemoryRepository } from "../storage/repositories/memory-repository.js";
import { extractMemoriesWithNlu } from "./nlu-memory-extractor.js";

export class MemoryService {
  private readonly repository = new MemoryRepository();

  getRecentContext(userId: string): ChatMessage[] {
    return this.repository.getRecent(userId);
  }

  appendTurn(userId: string, userText: string, assistantText: string): void {
    this.repository.appendTurn(userId, "user", userText);
    this.repository.appendTurn(userId, "assistant", assistantText);
    this.repository.trimShortTerm(userId);
    this.extractAndStoreMemory(userId, userText);
  }

  addLongTermMemory(userId: string, record: MemoryFact): void {
    this.repository.addLongTerm(userId, record);
  }

  getLongTermMemory(userId: string): MemoryFact[] {
    return this.repository.getLongTerm(userId);
  }

  buildPromptContext(userId: string, query: string): ChatMessage[] {
    const recent = this.getRecentContext(userId);
    const relevantFacts = retrieveRelevantFacts(this.getLongTermMemory(userId), query);
    if (relevantFacts.length === 0) {
      return recent;
    }
    const memorySummary = relevantFacts.map((fact) => `- (${fact.type}) ${fact.content}`).join("\n");
    return [{ role: "system", content: `Known memory:\n${memorySummary}` }, ...recent];
  }

  private extractAndStoreMemory(userId: string, text: string): void {
    const extracted = extractMemoriesWithNlu(text);
    for (const item of extracted) {
      this.addLongTermMemory(userId, item);
    }
  }
}
