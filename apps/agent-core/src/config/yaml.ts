import { readFileSync } from "node:fs";
import YAML from "yaml";
import { z } from "zod";

export function readYamlWithSchema<T>(filePath: string, schema: z.ZodType<T>): T {
  const raw = readFileSync(filePath, "utf8");
  const parsed = YAML.parse(raw);
  return schema.parse(parsed);
}
