import { describe, expect, it } from "vitest";
import { detectSkillAuthoringIntent, parseEnableSkillCommand } from "./skill-authoring.js";

describe("detectSkillAuthoringIntent", () => {
  it("detects create skill phrasing", () => {
    expect(detectSkillAuthoringIntent("Make yourself a new skill that summarizes URLs")).toBe(true);
    expect(detectSkillAuthoringIntent("I want you to build a skill which fetches weather")).toBe(true);
  });

  it("detects new skill", () => {
    expect(detectSkillAuthoringIntent("add a new skill for counting words")).toBe(true);
  });

  it("returns false for unrelated messages", () => {
    expect(detectSkillAuthoringIntent("what is the weather today")).toBe(false);
  });
});

describe("parseEnableSkillCommand", () => {
  it("parses enable skill id", () => {
    expect(parseEnableSkillCommand("enable skill my-widget")).toBe("my-widget");
    expect(parseEnableSkillCommand("turn on skill foo-bar")).toBe("foo-bar");
  });

  it("parses yes enable form", () => {
    expect(parseEnableSkillCommand("yes, enable my-widget")).toBe("my-widget");
  });
});
