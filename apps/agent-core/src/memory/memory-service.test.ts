import { describe, expect, it } from "vitest";
import { MemoryService } from "./memory-service.js";

describe("MemoryService", () => {
  it("stores short-term turns and long-term preference extraction", () => {
    const service = new MemoryService();
    service.appendTurn("user-1", "I prefer dark mode", "Noted");
    const facts = service.getLongTermMemory("user-1");
    expect(facts.some((item) => item.type === "preference")).toBe(true);
    expect(service.getRecentContext("user-1").length).toBeGreaterThan(0);
  });
});
