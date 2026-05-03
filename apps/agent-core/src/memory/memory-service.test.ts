import { describe, expect, it } from "vitest";
import type { AppSettings } from "../storage/repositories/settings-repository.js";
import { MemoryService } from "./memory-service.js";

const mockSettings = (): AppSettings =>
  ({
    memoryBear: {
      enabled: false,
      baseUrl: "",
      apiKey: "",
      searchSwitch: "2",
      storageType: "neo4j",
      syncWrites: false
    },
    sentiCore: { enabled: false, orchestrationMarkdownPath: "" },
    orpheusTts: { enabled: false, baseUrl: "", apiKey: "", voice: "", model: "", responseFormat: "mp3" }
  }) as unknown as AppSettings;

describe("MemoryService", () => {
  it("stores short-term turns and long-term preference extraction", async () => {
    const service = new MemoryService(mockSettings);
    service.appendTurn("user-1", "I prefer dark mode", "Noted");
    const facts = service.getLongTermMemory("user-1");
    expect(facts.some((item) => item.type === "preference")).toBe(true);
    expect(service.getRecentContext("user-1").length).toBeGreaterThan(0);
    const ctx = await service.buildPromptContext("user-1", "hello");
    expect(ctx.length).toBeGreaterThan(0);
    const compact = await service.buildCompactMemoryBearMessages("user-1", "hello");
    expect(compact).toEqual([]);
  });
});
