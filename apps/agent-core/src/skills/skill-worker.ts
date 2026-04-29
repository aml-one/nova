import { stdin, stdout } from "node:process";
import { pathToFileURL } from "node:url";

type RuntimeSkillModule = {
  default?: {
    run: (input: unknown) => Promise<unknown>;
  };
  cameraVisionSkill?: {
    run: (input: unknown) => Promise<unknown>;
  };
};

async function main(): Promise<void> {
  const source = process.env.NOVA_SKILL_SOURCE;
  if (!source) {
    throw new Error("NOVA_SKILL_SOURCE is required");
  }
  const inputRaw = await readStdin();
  const input = inputRaw ? JSON.parse(inputRaw) : {};
  const mod = (await import(pathToFileURL(source).href)) as RuntimeSkillModule;
  const skill = mod.default ?? mod.cameraVisionSkill;
  if (!skill) {
    throw new Error("skill module does not export a runnable skill");
  }
  const result = await skill.run(input);
  stdout.write(JSON.stringify(result));
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    stdin.on("data", (chunk) => {
      data += String(chunk);
    });
    stdin.on("end", () => resolve(data));
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
