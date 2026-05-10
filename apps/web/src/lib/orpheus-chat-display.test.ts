import { describe, expect, it } from "vitest";
import { stripOrpheusCuesForChatDisplay } from "./orpheus-chat-display";

describe("stripOrpheusCuesForChatDisplay", () => {
  it("removes well-formed cue tags", () => {
    expect(stripOrpheusCuesForChatDisplay("A <chuckles> B")).toBe("A B");
    expect(stripOrpheusCuesForChatDisplay("A <chuckle> B")).toBe("A B");
  });

  it("removes malformed chuckles open before dialogue", () => {
    expect(stripOrpheusCuesForChatDisplay("Örülök! <chuckles Akkor mondok")).toBe("Örülök! Akkor mondok");
  });
});
