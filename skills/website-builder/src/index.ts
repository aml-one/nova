import type { RuntimeSkill } from "@nova/skills";
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

type WebsiteBuilderInput = {
  mode?: "create" | "deploy" | "modify" | "list" | "delete";
  name?: string;
  domain?: string;
  subdomain?: string;
  prompt?: string;
  websiteId?: string;
  sshHost?: string;
  sshUser?: string;
  remoteWwwRoot?: string;
  deployScript?: string;
  caddyFilePath?: string;
};

export const websiteBuilderSkill: RuntimeSkill = {
  manifest: {
    id: "website-builder",
    name: "Website Builder",
    description:
      "Generate and evolve websites in temp folders, deploy via SSH to Ubuntu servers, update Caddy subdomain blocks, and keep editable semantic project plans.",
    permissions: ["filesystem", "shell", "network"],
    version: "0.1.0",
    settingsTab: {
      id: "website-builder",
      label: "Website Builder",
      tone: "purple",
      description: "SSH deployment and Caddy subdomain automation settings."
    }
  },
  async run(input: unknown): Promise<unknown> {
    const parsed = normalize(input);
    if (parsed.mode === "list") return listProjects();
    if (parsed.mode === "delete") return deleteProject(parsed.websiteId);
    if (parsed.mode === "modify") return modifyWebsite(parsed);
    if (parsed.mode === "deploy") return deployWebsite(parsed);
    return createWebsite(parsed);
  }
};

function normalize(input: unknown): Required<Pick<WebsiteBuilderInput, "mode">> & WebsiteBuilderInput {
  const parsed = (input ?? {}) as WebsiteBuilderInput;
  return {
    ...parsed,
    mode: parsed.mode ?? "create"
  };
}

function createWebsite(input: WebsiteBuilderInput): Record<string, unknown> {
  const name = (input.name ?? "nova-site").trim();
  const domain = (input.domain ?? "example.com").trim();
  const subdomain = (input.subdomain ?? "www").trim();
  const prompt = (input.prompt ?? "modern landing page with hero, CTA, features, and footer").trim();
  const id = randomUUID();
  const localRoot = resolve(process.cwd(), "data", "websites-temp");
  const localPath = join(localRoot, `${name}-${id.slice(0, 8)}`);
  mkdirSync(localPath, { recursive: true });
  const html = generateHtml(name, prompt);
  const css = generateCss(prompt);
  writeFileSync(join(localPath, "index.html"), html, "utf8");
  writeFileSync(join(localPath, "styles.css"), css, "utf8");
  const semanticPlan = JSON.stringify({
    originalPrompt: prompt,
    structure: ["hero", "features", "cta", "footer"],
    styleIntent: inferStyle(prompt),
    editableTargets: ["colors", "buttons", "layout", "typography"]
  });
  db()
    .prepare(
      `INSERT INTO website_projects
      (id, name, domain, subdomain, local_path, remote_www_root, remote_subfolder, semantic_plan)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, name, domain, subdomain, localPath, input.remoteWwwRoot?.trim() || "/var/www", `${subdomain}.${domain}`, semanticPlan);
  return { id, name, domain, subdomain, localPath, semanticPlan: JSON.parse(semanticPlan) };
}

function modifyWebsite(input: WebsiteBuilderInput): Record<string, unknown> {
  const project = resolveProject(input.websiteId, input.name);
  if (!project) throw new Error("website project not found");
  const prompt = (input.prompt ?? "").toLowerCase();
  const cssPath = join(project.local_path, "styles.css");
  const htmlPath = join(project.local_path, "index.html");
  let css = existsSync(cssPath) ? readFileSync(cssPath, "utf8") : "";
  let html = existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "";
  if (prompt.includes("background")) {
    css = css.replace(/--bg:\s*[^;]+;/, "--bg: #0f172a;");
  }
  if (prompt.includes("button")) {
    css = css.replace(/--button:\s*[^;]+;/, "--button: #a855f7;");
  }
  if (prompt.includes("modern") || prompt.includes("redesign")) {
    css = css.replace(/--radius:\s*[^;]+;/, "--radius: 20px;");
    html = html.replace("<h1>", "<h1 class=\"headline\">");
  }
  writeFileSync(cssPath, css, "utf8");
  writeFileSync(htmlPath, html, "utf8");
  const nextPlan = updatePlan(project.semantic_plan, input.prompt ?? "");
  db().prepare("UPDATE website_projects SET semantic_plan = ? WHERE id = ?").run(nextPlan, project.id);
  return { id: project.id, updated: true, prompt: input.prompt ?? "", semanticPlan: JSON.parse(nextPlan) };
}

function deployWebsite(input: WebsiteBuilderInput): Record<string, unknown> {
  const project = resolveProject(input.websiteId, input.name);
  if (!project) throw new Error("website project not found");
  const sshHost = input.sshHost?.trim();
  const sshUser = input.sshUser?.trim() || "root";
  if (!sshHost) {
    return { ok: false, error: "sshHost is required for deployment", projectId: project.id };
  }
  const remoteRoot = input.remoteWwwRoot?.trim() || project.remote_www_root;
  const remoteSubfolder = project.remote_subfolder;
  const remoteDir = `${remoteRoot}/${remoteSubfolder}`;
  const deployId = randomUUID();
  run(`ssh ${sshUser}@${sshHost} "mkdir -p ${escape(remoteDir)}"`);
  run(`scp -r "${project.local_path}${process.platform === "win32" ? "\\*" : "/*"}" ${sshUser}@${sshHost}:${escape(remoteDir)}/`);
  const caddyPath = input.caddyFilePath?.trim() || "/etc/caddy/Caddyfile";
  const hostLine = `${project.subdomain}.${project.domain}`;
  const caddyBlock = `${hostLine} {\n  root * ${remoteDir}\n  file_server\n}\n`;
  run(`ssh ${sshUser}@${sshHost} "grep -q '${hostLine}' ${caddyPath} || printf '\\n${escapeForSsh(caddyBlock)}\\n' | sudo tee -a ${caddyPath} >/dev/null"`);
  if (input.deployScript?.trim()) {
    run(`ssh ${sshUser}@${sshHost} "bash ${escape(input.deployScript.trim())}"`);
  } else {
    run(`ssh ${sshUser}@${sshHost} "sudo systemctl restart caddy"`);
  }
  db().prepare("UPDATE website_projects SET last_deployed_at = CURRENT_TIMESTAMP WHERE id = ?").run(project.id);
  db().prepare("INSERT INTO website_deployments (id, project_id, status, details) VALUES (?, ?, ?, ?)").run(
    deployId,
    project.id,
    "success",
    JSON.stringify({ sshHost, sshUser, remoteDir, caddyPath })
  );
  return { ok: true, deployId, projectId: project.id, remoteDir, host: hostLine };
}

function deleteProject(websiteId: string | undefined): Record<string, unknown> {
  if (!websiteId) throw new Error("websiteId is required");
  const project = db().prepare("SELECT id, local_path FROM website_projects WHERE id = ? LIMIT 1").get(websiteId) as
    | { id: string; local_path: string }
    | undefined;
  if (!project) return { ok: false, error: "not found" };
  if (existsSync(project.local_path)) rmSync(project.local_path, { recursive: true, force: true });
  db().prepare("DELETE FROM website_projects WHERE id = ?").run(websiteId);
  return { ok: true, id: websiteId };
}

function listProjects(): Record<string, unknown> {
  const items = db()
    .prepare(
      "SELECT id, name, domain, subdomain, local_path, remote_www_root, remote_subfolder, semantic_plan, last_deployed_at, created_at FROM website_projects ORDER BY datetime(created_at) DESC"
    )
    .all();
  return { items };
}

function resolveProject(websiteId: string | undefined, name: string | undefined): Record<string, string> | undefined {
  if (websiteId) {
    return db()
      .prepare(
        "SELECT id, name, domain, subdomain, local_path, remote_www_root, remote_subfolder, semantic_plan FROM website_projects WHERE id = ? LIMIT 1"
      )
      .get(websiteId) as Record<string, string> | undefined;
  }
  if (name) {
    const lowered = name.toLowerCase();
    const rows = db()
      .prepare(
        "SELECT id, name, domain, subdomain, local_path, remote_www_root, remote_subfolder, semantic_plan FROM website_projects ORDER BY datetime(created_at) DESC LIMIT 50"
      )
      .all() as Array<Record<string, string>>;
    return rows.find((row) => row.name.toLowerCase().includes(lowered) || `${row.subdomain}.${row.domain}`.includes(lowered));
  }
  return undefined;
}

function updatePlan(raw: string, prompt: string): string {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  const edits = Array.isArray(parsed.edits) ? parsed.edits : [];
  edits.push({ at: new Date().toISOString(), prompt });
  return JSON.stringify({ ...parsed, edits });
}

function generateHtml(name: string, prompt: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${name}</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <main class="wrap">
      <section class="hero">
        <h1>${name}</h1>
        <p>${prompt}</p>
        <button>Get Started</button>
      </section>
      <section class="features">
        <article><h3>Fast</h3><p>Optimized landing structure.</p></article>
        <article><h3>Clean</h3><p>Readable modern layout.</p></article>
        <article><h3>Deployable</h3><p>Ready for Caddy + Ubuntu.</p></article>
      </section>
    </main>
  </body>
</html>`;
}

function generateCss(prompt: string): string {
  const style = inferStyle(prompt);
  const accent = style === "modern" ? "#a855f7" : "#2563eb";
  return `:root { --bg: #0b1020; --fg: #e2e8f0; --button: ${accent}; --radius: 14px; }
* { box-sizing: border-box; }
body { margin: 0; font-family: Inter, system-ui, sans-serif; background: radial-gradient(circle at top, #111827, var(--bg)); color: var(--fg); }
.wrap { max-width: 1100px; margin: 0 auto; padding: 48px 20px; }
.hero { border: 1px solid #334155; border-radius: var(--radius); padding: 32px; background: rgba(15, 23, 42, 0.8); }
button { background: var(--button); color: white; border: 0; border-radius: 10px; padding: 12px 18px; cursor: pointer; }
.features { margin-top: 24px; display: grid; grid-template-columns: repeat(auto-fit,minmax(180px,1fr)); gap: 12px; }
.features article { border: 1px solid #334155; border-radius: 12px; padding: 14px; background: rgba(15, 23, 42, 0.6); }`;
}

function inferStyle(prompt: string): "modern" | "classic" {
  return prompt.toLowerCase().includes("modern") ? "modern" : "classic";
}

function run(command: string): void {
  const output = spawnSync(command, { shell: true, encoding: "utf8", timeout: 60_000 });
  if (output.status !== 0) {
    throw new Error(output.stderr || output.stdout || `command failed: ${command}`);
  }
}

function escape(value: string): string {
  return value.replace(/(["\s'$`\\])/g, "\\$1");
}

function escapeForSsh(value: string): string {
  return value.replace(/'/g, "'\\''");
}

function db(): DatabaseSync {
  return new DatabaseSync(resolve(process.cwd(), "data", "state", "nova.db"));
}

export default websiteBuilderSkill;
