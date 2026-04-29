import { spawnSync } from "node:child_process";

export type ValidationReport = {
  lintPassed: boolean;
  typecheckPassed: boolean;
  testsPassed: boolean;
  details: string[];
};

export function isValidationPass(report: ValidationReport): boolean {
  return report.lintPassed && report.typecheckPassed && report.testsPassed;
}

export function runValidationGate(): ValidationReport {
  const lint = runCommand("corepack", ["pnpm", "lint"]);
  const typecheck = runCommand("corepack", ["pnpm", "typecheck"]);
  const tests = runCommand("corepack", ["pnpm", "test"]);
  return {
    lintPassed: lint.ok,
    typecheckPassed: typecheck.ok,
    testsPassed: tests.ok,
    details: [lint.message, typecheck.message, tests.message]
  };
}

function runCommand(command: string, args: string[]): { ok: boolean; message: string } {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    shell: true,
    encoding: "utf8"
  });
  return {
    ok: result.status === 0,
    message: `${command} ${args.join(" ")} => ${result.status ?? -1}`
  };
}
