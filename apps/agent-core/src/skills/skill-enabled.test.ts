import { describe, expect, it } from "vitest";
import { isSkillRuntimeEnabled } from "./skill-enabled.js";

describe("isSkillRuntimeEnabled", () => {
  it("defaults built-in skills on when unset", () => {
    expect(isSkillRuntimeEnabled({}, "website-builder")).toBe(true);
    expect(isSkillRuntimeEnabled({}, "perplexica-websearch")).toBe(true);
    expect(isSkillRuntimeEnabled({}, "network-defense")).toBe(true);
  });

  it("defaults camera off when unset", () => {
    expect(isSkillRuntimeEnabled({}, "camera-vision")).toBe(false);
  });

  it("respects explicit booleans", () => {
    expect(isSkillRuntimeEnabled({ "website-builder": { enabled: false } }, "website-builder")).toBe(false);
    expect(isSkillRuntimeEnabled({ "website-builder": { enabled: true } }, "website-builder")).toBe(true);
  });

  it("Nova-authored skills default off until enabled", () => {
    expect(isSkillRuntimeEnabled({ "my-skill": { authoredByNova: true } }, "my-skill")).toBe(false);
    expect(isSkillRuntimeEnabled({ "my-skill": { authoredByNova: true, enabled: true } }, "my-skill")).toBe(true);
  });
});
