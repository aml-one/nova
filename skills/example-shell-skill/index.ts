import { exec } from "node:child_process";

type Input = {
  command: string;
};

export const exampleShellSkill = {
  manifest: {
    id: "example-shell-skill",
    name: "Example Shell Skill",
    description: "Runs a shell command and returns stdout.",
    permissions: ["shell"],
    version: "0.1.0"
  },
  async run(input: Input): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      exec(input.command, { timeout: 15000 }, (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      });
    });
  }
};

export default exampleShellSkill;
