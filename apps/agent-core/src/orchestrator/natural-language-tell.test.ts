import { describe, expect, it } from "vitest";
import { parseNaturalLanguageRelayToPerson } from "./natural-language-tell.js";

describe("parseNaturalLanguageRelayToPerson", () => {
  it("parses Nova, please tell &lt;Name&gt; to …", () => {
    const r = parseNaturalLanguageRelayToPerson(
      "Nova, please tell Anita to keep talking to you, so you can practice social skills.. :)"
    );
    expect(r?.name).toBe("Anita");
    expect(r?.message).toContain("keep talking");
    expect(r?.message).toContain("practice social skills");
  });

  it("parses tell … that … after stripping vocative", () => {
    const r = parseNaturalLanguageRelayToPerson(`Hey Nova — tell Bob that the meeting moved to 3pm`);
    expect(r?.name).toBe("Bob");
    expect(r?.message).toContain("meeting moved");
  });

  it("does not match slash commands", () => {
    expect(parseNaturalLanguageRelayToPerson("/tell Anita: hello")).toBeUndefined();
  });

  it("does not treat tell me to as relay", () => {
    expect(parseNaturalLanguageRelayToPerson("Can you tell me how to fix this?")).toBeUndefined();
  });

  it("parses ask … to …", () => {
    const r = parseNaturalLanguageRelayToPerson("please ask Carla to send the doc");
    expect(r?.name).toBe("Carla");
    expect(r?.message).toBe("send the doc");
  });
});
