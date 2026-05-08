import { describe, expect, it } from "vitest";
import {
  canonicalRepoRelativePathIfExistingFile,
  normalizeProposedRepoRelativePath,
  sanitizeImprovementProposalDetailsBody,
  tryResolveImprovementTargetPath
} from "./improvement-target-path.js";
import { resolveNovaRepoRoot } from "../util/resolve-repo-root.js";

describe("improvement-target-path", () => {
  const repoRoot = resolveNovaRepoRoot();

  it("normalizeProposedRepoRelativePath rejects traversal", () => {
    expect(normalizeProposedRepoRelativePath("apps/agent-core/src/../../../etc/passwd")).toBeUndefined();
    expect(normalizeProposedRepoRelativePath("../foo/bar.ts")).toBeUndefined();
  });

  it("normalizeProposedRepoRelativePath rejects absolute paths", () => {
    expect(normalizeProposedRepoRelativePath("/etc/passwd")).toBeUndefined();
    expect(normalizeProposedRepoRelativePath("C:/Windows/foo.ts")).toBeUndefined();
  });

  it("normalizeProposedRepoRelativePath strips quotes and backticks", () => {
    expect(normalizeProposedRepoRelativePath("`apps/web/src/app/page.tsx`")).toBe("apps/web/src/app/page.tsx");
  });

  it("canonicalRepoRelativePathIfExistingFile returns only existing safe-root files", () => {
    expect(canonicalRepoRelativePathIfExistingFile("packages/sdk/src/provider.ts", repoRoot)).toBe(
      "packages/sdk/src/provider.ts"
    );
    expect(
      canonicalRepoRelativePathIfExistingFile("packages/sdk/src/definitely-missing-nova-test-99999.ts", repoRoot)
    ).toBeUndefined();
  });

  it("canonicalRepoRelativePathIfExistingFile rejects deny-listed paths even if they exist", () => {
    expect(
      canonicalRepoRelativePathIfExistingFile("apps/agent-core/src/transport/http-server.ts", repoRoot)
    ).toBeUndefined();
  });

  it("sanitizeImprovementProposalDetailsBody drops invalid Target file lines", () => {
    const details = "Why: test\nTarget file: packages/sdk/src/definitely-missing-nova-test-99999.ts\nDone Signal: x";
    const out = sanitizeImprovementProposalDetailsBody(details, repoRoot);
    expect(out).not.toMatch(/definitely-missing/);
    expect(out).toMatch(/Why:/);
    expect(out).toMatch(/Done Signal:/);
  });

  it("sanitizeImprovementProposalDetailsBody rewrites valid targets to canonical form", () => {
    const details = "Why: x\nTarget file: ./packages/sdk/src/provider.ts\nDone Signal: y";
    const out = sanitizeImprovementProposalDetailsBody(details, repoRoot);
    expect(out).toContain("Target file: packages/sdk/src/provider.ts");
  });

  it("tryResolveImprovementTargetPath does not map arbitrary names without supporting hints", () => {
    expect(tryResolveImprovementTargetPath("packages/sdk/src/types.ts", repoRoot)).toBeUndefined();
  });

  it("tryResolveImprovementTargetPath can repair using title/summary-style hints", () => {
    const hint = "Consolidate shared types; edit the sdk provider entrypoint";
    expect(tryResolveImprovementTargetPath("packages/sdk/src/types.ts", repoRoot, undefined, hint)).toBe(
      "packages/sdk/src/provider.ts"
    );
  });

  it("sanitizeImprovementProposalDetailsBody repairs target when hintText matches a real file", () => {
    const details = "Why: x\nTarget file: packages/sdk/src/types.ts\nDone Signal: y";
    const hint = "Improve the sdk provider surface";
    const out = sanitizeImprovementProposalDetailsBody(details, repoRoot, { hintText: hint });
    expect(out).toContain("Target file: packages/sdk/src/provider.ts");
  });
});
