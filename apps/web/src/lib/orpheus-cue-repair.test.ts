import { describe, expect, it } from "vitest";
import { repairUnclosedOrpheusCueOpens } from "./orpheus-cue-repair";

describe("repairUnclosedOrpheusCueOpens", () => {
  it("fixes space-separated broken chuckle", () => {
    expect(repairUnclosedOrpheusCueOpens("Szívesen! <chuckle Akkor egy")).toContain("<chuckle> Akkor");
  });

  it("fixes glued chuckle + word", () => {
    expect(repairUnclosedOrpheusCueOpens("Hi <chuckleThere")).toBe("Hi <chuckle> There");
  });
});
