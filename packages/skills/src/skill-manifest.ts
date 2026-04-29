export type SkillPermission = "filesystem" | "network" | "shell" | "camera";

export type JsonSchema = {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

export type SkillManifest = {
  id: string;
  name: string;
  description: string;
  permissions: SkillPermission[];
  version: string;
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
};
