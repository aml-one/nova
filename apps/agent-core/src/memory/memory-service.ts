import type { ChatMessage } from "@nova/sdk/provider";
import type { MemoryFact } from "./long-term-store.js";
import { retrieveRelevantFacts } from "./retrieval.js";
import { MemoryRepository } from "../storage/repositories/memory-repository.js";
import { extractMemoriesWithNlu } from "./nlu-memory-extractor.js";
import type { AppSettings } from "../storage/repositories/settings-repository.js";
import { MemoryBearLinkRepository } from "./memory-bear-link-repository.js";
import { memoryBearCreateEndUser, memoryBearReadSync, memoryBearWriteSync } from "./memory-bear-client.js";

export class MemoryService {
  private readonly repository = new MemoryRepository();
  private readonly memoryBearLinks = new MemoryBearLinkRepository();

  constructor(private readonly getSettings: () => AppSettings) {}

  getRecentContext(userId: string): ChatMessage[] {
    return this.repository.getRecent(userId);
  }

  appendTurn(userId: string, userText: string, assistantText: string): void {
    this.repository.appendTurn(userId, "user", userText);
    this.repository.appendTurn(userId, "assistant", assistantText);
    this.repository.trimShortTerm(userId);
    this.extractAndStoreMemory(userId, userText);
    void this.syncMemoryBearTurn(userId, userText, assistantText);
  }

  addLongTermMemory(userId: string, record: MemoryFact): void {
    this.repository.addLongTerm(userId, record);
  }

  getLongTermMemory(userId: string): MemoryFact[] {
    return this.repository.getLongTerm(userId);
  }

  async buildPromptContext(userId: string, query: string): Promise<ChatMessage[]> {
    const recent = this.getRecentContext(userId);
    const relevantFacts = retrieveRelevantFacts(this.getLongTermMemory(userId), query);
    const localBlock =
      relevantFacts.length === 0
        ? ""
        : `Known memory (local):\n${relevantFacts.map((fact) => `- (${fact.type}) ${fact.content}`).join("\n")}`;
    const mb = await this.fetchMemoryBearContext(userId, query);
    const mbBlock = mb ? `MemoryBear (long-term service):\n${mb}` : "";
    const systemParts = [localBlock, mbBlock].filter(Boolean);
    if (systemParts.length === 0) {
      return recent;
    }
    return [{ role: "system", content: systemParts.join("\n\n") }, ...recent];
  }

  private async fetchMemoryBearContext(userId: string, query: string): Promise<string | undefined> {
    const settings = this.getSettings().memoryBear;
    if (!settings.enabled || !settings.apiKey.trim() || !settings.baseUrl.trim()) {
      return undefined;
    }
    const link = await this.ensureMemoryBearUser(userId);
    if (!link) {
      return undefined;
    }
    return memoryBearReadSync({
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      endUserId: link.endUserId,
      configId: link.memoryConfigId,
      message: query,
      searchSwitch: settings.searchSwitch,
      storageType: settings.storageType
    });
  }

  private async ensureMemoryBearUser(userId: string) {
    const settings = this.getSettings().memoryBear;
    if (!settings.enabled || !settings.apiKey.trim() || !settings.baseUrl.trim()) {
      return undefined;
    }
    const existing = this.memoryBearLinks.get(userId);
    if (existing) {
      return existing;
    }
    const created = await memoryBearCreateEndUser({
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      otherId: `nova:${userId}`,
      otherName: userId
    });
    if (!created) {
      return undefined;
    }
    const link = {
      novaUserId: userId,
      endUserId: created.endUserId,
      memoryConfigId: created.memoryConfigId
    };
    this.memoryBearLinks.upsert(link);
    return link;
  }

  private async syncMemoryBearTurn(userId: string, userText: string, assistantText: string): Promise<void> {
    const settings = this.getSettings().memoryBear;
    if (!settings.enabled || !settings.syncWrites || !settings.apiKey.trim() || !settings.baseUrl.trim()) {
      return;
    }
    const link = await this.ensureMemoryBearUser(userId);
    if (!link) {
      return;
    }
    await memoryBearWriteSync({
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      endUserId: link.endUserId,
      configId: link.memoryConfigId,
      userText,
      assistantText,
      storageType: settings.storageType
    });
  }

  private extractAndStoreMemory(userId: string, text: string): void {
    const extracted = extractMemoriesWithNlu(text);
    for (const item of extracted) {
      this.addLongTermMemory(userId, item);
    }
  }
}
