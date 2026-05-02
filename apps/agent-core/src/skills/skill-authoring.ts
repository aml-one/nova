import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { normalize, resolve, sep } from "node:path";
import { z } from "zod";
import type { ChatMessage } from "@nova/sdk/provider";
import type { ModelRouter } from "../providers/router.js";
import type { MemoryService } from "../memory/memory-service.js";
import type { InMemorySkillRegistry } from "./skill-registry.js";
import type { SettingsService } from "../settings/settings-service.js";
import { resolveWorkspaceSkillsRoot, reloadWorkspaceSkills } from "./dynamic-skill-loader.js";

const RESERVED_SKILL_DIRS = new Set(["_templates", "example-shell-skill"]);

const planSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("clarify"),
    questions: z.array(z.string()).min(1).max(8)
  }),
  z.object({
    mode: z.literal("implement"),
    skillId: z.string().min(2).max(48).transform((s) => s.trim().toLowerCase()),
    name: z.string().min(1).max(120),
    description: z.string().min(1).max(2000),
    permissions: z.array(z.enum(["filesystem", "network", "shell", "camera"])).default([])
  })
]);

export function detectSkillAuthoringIntent(text: string): boolean {
  if (process.env.NOVA_SKILL_AUTHORING_DISABLED === "true") {
    return false;
  }
  const trimmed = text.trim();
  if (trimmed.length > 8000) {
    return false;
  }
  if (/\b(no skill|without a skill|don'?t (want|need) (a |a new )?skill)\b/i.test(trimmed)) {
    return false;
  }
  const t = trimmed.toLowerCase();
  if (
    /\b(create|make|build|write|design|add)\b[\s\S]{0,120}\bskill\b/i.test(trimmed) ||
    /\bnew\s+skill\b/i.test(t) ||
    /\bskill\b[\s\S]{0,80}\b(that|which|to)\b[\s\S]{0,60}\b(will|should|does|do|can|for)\b/i.test(t) ||
    /\b(author|scaffold)\b[\s\S]{0,40}\bskill\b/i.test(t)
  ) {
    return true;
  }
  return false;
}

export function parseEnableSkillCommand(text: string): string | null {
  const trimmed = text.trim();
  const patterns = [
    /^(?:enable|turn on|activate)\s+skill\s+([a-z][a-z0-9-]*)\s*$/i,
    /^(?:yes|please|ok)\s*,?\s*(?:enable|turn on|activate)\s+(?:skill\s+)?([a-z][a-z0-9-]*)\s*$/i
  ];
  for (const pattern of patterns) {
    const m = trimmed.match(pattern);
    if (m?.[1]) {
      return m[1].toLowerCase();
    }
  }
  return null;
}

function normalizeSkillId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 48);
}

function isValidSkillId(id: string): boolean {
  return /^[a-z][a-z0-9-]{0,47}$/.test(id) && !RESERVED_SKILL_DIRS.has(id) && id.length >= 2;
}

function uniqueSkillDir(skillsRoot: string, baseId: string): string {
  const raw =
    (baseId || "nova-skill")
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-{2,}/g, "-")
      .slice(0, 40) || "nova-skill";
  const baseStem = raw.replace(/-v\d+$/i, "");
  const tryCandidate = (id: string) =>
    /^[a-z][a-z0-9-]{0,47}$/.test(id) &&
    !RESERVED_SKILL_DIRS.has(id) &&
    !existsSync(resolve(skillsRoot, id));
  if (tryCandidate(raw)) {
    return raw;
  }
  for (let i = 2; i < 200; i += 1) {
    const suffix = `-v${i}`;
    const stem = baseStem.slice(0, Math.max(2, 48 - suffix.length));
    const candidate = `${stem}${suffix}`;
    if (tryCandidate(candidate)) {
      return candidate;
    }
  }
  return `nova-skill-${Date.now()}`.replace(/[^a-z0-9-]/g, "").slice(0, 48);
}

function dirPrefix(root: string): string {
  const n = normalize(resolve(root));
  return n.endsWith(sep) ? n : n + sep;
}

function extractPlanJson(reply: string): { userText: string; plan: z.infer<typeof planSchema> } {
  const match = reply.match(/NOVA_SKILL_JSON_BEGIN\s*([\s\S]*?)NOVA_SKILL_JSON_END/i);
  if (!match?.[1]) {
    throw new Error("missing NOVA_SKILL_JSON markers");
  }
  const userText = (match.index !== undefined ? reply.slice(0, match.index) : reply).trim();
  const raw = match[1].trim();
  const parsed = JSON.parse(raw) as unknown;
  const plan = planSchema.parse(parsed);
  return { userText, plan };
}

function extractTypeScriptBlock(reply: string): string {
  const fence = reply.match(/```(?:typescript|ts)\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    return fence[1].trim();
  }
  const anyFence = reply.match(/```\s*([\s\S]*?)```/);
  if (anyFence?.[1]) {
    return anyFence[1].trim();
  }
  return reply.trim();
}

function validateGeneratedSource(source: string, skillId: string): void {
  if (!source.includes("export default")) {
    throw new Error("generated skill must export default");
  }
  if (!source.includes("manifest")) {
    throw new Error("generated skill must define manifest");
  }
  if (!/\brun\s*\(/.test(source)) {
    throw new Error("generated skill must define run()");
  }
  const idPattern = new RegExp(`id\\s*:\\s*["']${skillId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`);
  if (!idPattern.test(source)) {
    throw new Error(`generated source must set manifest.id to "${skillId}"`);
  }
}

async function modelChatWithFallback(
  router: ModelRouter,
  messages: ChatMessage[],
  model?: string
): Promise<{ content: string; provider: string; model: string; firstTokenMs?: number }> {
  try {
    const r = await router.chat(messages, model);
    return {
      content: r.content,
      provider: r.provider ?? "unknown",
      model: r.model ?? "unknown",
      firstTokenMs: r.firstTokenMs
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/copilot provider is not configured|fetch failed|failed to fetch|econnrefused|etimedout/i.test(message)) {
      const r = await router.chatLocalFirst(messages, model);
      return {
        content: r.content,
        provider: r.provider ?? "unknown",
        model: r.model ?? "unknown",
        firstTokenMs: r.firstTokenMs
      };
    }
    throw error;
  }
}

function pumpStreamTokens(full: string, onToken?: (token: string) => void): void {
  if (!onToken) {
    return;
  }
  for (const chunk of full.split(/(\s+)/)) {
    if (chunk) {
      onToken(chunk);
    }
  }
}

const PLANNER_SYSTEM = `You are Nova's workspace skill author. The user wants a new Nova skill (TypeScript under the repo skills/ folder).

Your job in this turn:
1) Write a short, natural reply: acknowledge the goal, outline your plan or ask clarifying questions.
2) Then output the markers NOVA_SKILL_JSON_BEGIN and NOVA_SKILL_JSON_END with ONLY JSON between them (no markdown fences around the JSON).

JSON schema (pick one mode):
- Clarifying: {"mode":"clarify","questions":["..."]} — use when requirements are vague, risky, or need user choices. Ask at most 5 focused questions.
- Ready to implement: {"mode":"implement","skillId":"kebab-case-id","name":"Human name","description":"What run() should do","permissions":[]} — permissions may only be: filesystem, network, shell, camera (omit or [] if none).

skillId rules: lowercase letters, digits, hyphen; start with a letter; max 40 chars; no reserved names _templates or example-shell-skill.

If the user already gave enough detail to implement safely, use mode implement. Prefer clarify when shell/network access is needed but unclear.`;

const CODEGEN_SYSTEM_PREFIX = `You write one TypeScript file for a Nova workspace skill.

Hard requirements:
- Default export: { manifest: { id, name, description, permissions, version: "0.1.0" }, async run(input: unknown) => ... }
- Start with: import type { RuntimeSkill } from "@nova/skills";
- Export as: const skill: RuntimeSkill = { ... }; export default skill;
- Use only permissions listed in the user message.
- Validate and narrow input types inside run(); return plain JSON-serializable objects on success.
- No subprocess unless "shell" is in permissions.

Output ONLY one markdown fenced block labeled typescript containing the full file.`;

export type SkillAuthoringResult = {
  reply: string;
  provider: string;
  modelName: string;
  firstTokenMs?: number;
  wroteSkillId?: string;
};

export async function runSkillAuthoringFlow(options: {
  userText: string;
  userId: string;
  modelRouter: ModelRouter;
  memoryService: MemoryService;
  skillRegistry: InMemorySkillRegistry;
  settingsService: SettingsService;
  model?: string;
  onToken?: (token: string) => void;
}): Promise<SkillAuthoringResult> {
  const { userText, userId, modelRouter, memoryService, skillRegistry, settingsService, model, onToken } = options;

  const recent = memoryService.getRecentContext(userId).slice(-14);
  const planMessages: ChatMessage[] = [
    { role: "system", content: PLANNER_SYSTEM },
    ...recent,
    { role: "user", content: userText }
  ];

  if (onToken) {
    onToken("Planning the skill and checking what to ask or build…\n\n");
  }

  const planReply = await modelChatWithFallback(modelRouter, planMessages, model);
  let userFacing: string;
  let plan: z.infer<typeof planSchema>;
  try {
    const extracted = extractPlanJson(planReply.content);
    userFacing = extracted.userText || "Here is the next step.";
    plan = extracted.plan;
  } catch {
    userFacing =
      planReply.content.split(/NOVA_SKILL_JSON_BEGIN/i)[0]?.trim() ||
      "I could not parse a structured plan. Please say what the skill should do, what inputs it needs, and whether it may use filesystem, network, shell, or camera.";
    pumpStreamTokens(`${userFacing}\n\n(Try again with a clearer goal, or ask me to break it into smaller steps.)`, onToken);
    return {
      reply: `${userFacing}\n\n(Try again with a clearer goal, or ask me to break it into smaller steps.)`,
      provider: planReply.provider,
      modelName: planReply.model
    };
  }

  pumpStreamTokens(`${userFacing}\n\n`, onToken);

  if (plan.mode === "clarify") {
    const body = `${userFacing}\n\n${plan.questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}`;
    pumpStreamTokens(`${plan.questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}\n`, onToken);
    return { reply: body, provider: planReply.provider, modelName: planReply.model, firstTokenMs: planReply.firstTokenMs };
  }

  const skillsRoot = resolveWorkspaceSkillsRoot();
  if (!skillsRoot) {
    const err = "Could not locate the workspace `skills/` directory (expected next to the repo root).";
    pumpStreamTokens(err, onToken);
    return { reply: err, provider: planReply.provider, modelName: planReply.model };
  }

  const requested = normalizeSkillId(plan.skillId);
  const base = isValidSkillId(requested) ? requested : "nova-author-skill";
  const skillId = uniqueSkillDir(skillsRoot, base);

  const codegenMessages: ChatMessage[] = [
    {
      role: "system",
      content: `${CODEGEN_SYSTEM_PREFIX}\n\nThe manifest id MUST be exactly: ${skillId}\nName: ${plan.name}\nDescription: ${plan.description}\nPermissions: ${JSON.stringify(plan.permissions)}`
    },
    { role: "user", content: "Generate the skill module now." }
  ];

  if (onToken) {
    onToken(`\nGenerating TypeScript for skill \`${skillId}\`…\n\n`);
  }

  const codeReply = await modelChatWithFallback(modelRouter, codegenMessages, model);
  let source: string;
  try {
    source = extractTypeScriptBlock(codeReply.content);
    validateGeneratedSource(source, skillId);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "codegen failed";
    const reply = `${userFacing}\n\nI drafted a plan but code generation failed (${msg}). Try simplifying the skill or answer the clarifying questions first.`;
    pumpStreamTokens(`I drafted a plan but code generation failed (${msg}). Try simplifying the skill or answer the clarifying questions first.`, onToken);
    return { reply, provider: codeReply.provider, modelName: codeReply.model };
  }

  const outDir = resolve(skillsRoot, skillId, "src");
  mkdirSync(outDir, { recursive: true });
  const outFile = resolve(outDir, "index.ts");
  writeFileSync(outFile, source, "utf8");

  const reload = await reloadWorkspaceSkills(skillRegistry);
  const loaded = reload.loaded.includes(skillId);
  if (!loaded) {
    const errText = reload.errors.map((e) => `${e.skill}: ${e.message}`).join("; ") || "check agent-core logs";
    const reply = `${userFacing}\n\nI wrote \`${outFile}\` but hot-reload did not register the skill yet (${errText}). Restart agent-core after fixing any syntax errors.`;
    pumpStreamTokens(`\n${reply.split("\n\n").slice(1).join("\n\n")}\n`, onToken);
    return { reply, provider: codeReply.provider, modelName: codeReply.model, wroteSkillId: skillId };
  }

  const current = settingsService.get();
  settingsService.updatePartial({
    skillSettings: {
      ...current.skillSettings,
      [skillId]: {
        ...((current.skillSettings[skillId] as Record<string, unknown> | undefined) ?? {}),
        enabled: false,
        authoredByNova: true
      }
    }
  });

  const footer = `\n\n---\n**Skill saved** as \`${skillId}\` at \`skills/${skillId}/src/index.ts\`.\nOpen **Settings → Skills** to review the manifest and toggle **enabled**.\nTo turn it on from chat, send: \`enable skill ${skillId}\`.\nShould I enable \`${skillId}\` for you now? (Reply with \`enable skill ${skillId}\`.)`;
  const fullReply = `${userFacing}${footer}`;
  pumpStreamTokens(footer, onToken);

  return {
    reply: fullReply,
    provider: codeReply.provider,
    modelName: codeReply.model,
    wroteSkillId: skillId,
    firstTokenMs: planReply.firstTokenMs
  };
}

export function enableAuthoredSkill(options: {
  skillId: string;
  settingsService: SettingsService;
  skillRegistry: InMemorySkillRegistry;
}): { ok: true; message: string } | { ok: false; message: string } {
  const { skillId, settingsService, skillRegistry } = options;
  const normalized = normalizeSkillId(skillId);
  if (!isValidSkillId(normalized)) {
    return { ok: false, message: `Invalid skill id: ${skillId}` };
  }
  if (!skillRegistry.get(normalized)) {
    return { ok: false, message: `Skill "${normalized}" is not loaded. Check the Skills tab or restart agent-core after adding files.` };
  }
  const current = settingsService.get();
  settingsService.updatePartial({
    skillSettings: {
      ...current.skillSettings,
      [normalized]: {
        ...((current.skillSettings[normalized] as Record<string, unknown> | undefined) ?? {}),
        enabled: true
      }
    }
  });
  return {
    ok: true,
    message: `Skill **${normalized}** is now **enabled** in Settings. You can adjust it any time under **Settings → Skills**.`
  };
}
