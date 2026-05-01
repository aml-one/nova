#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const provider = readArg("--provider") ?? "";

if (provider !== "github-copilot") {
  console.error('Unsupported provider. Use: npm run login -- --provider=github-copilot');
  process.exit(1);
}

/**
 * Same public device-flow OAuth client id used by official GitHub Copilot integrations
 * (VS Code extension, copilot.vim, etc.). It is not secret; override with NOVA_GITHUB_OAUTH_CLIENT_ID if needed.
 */
const DEFAULT_GITHUB_COPILOT_DEVICE_CLIENT_ID = "Iv1.b507a08c87ecfe98";

const clientId =
  process.env.NOVA_GITHUB_OAUTH_CLIENT_ID?.trim() || DEFAULT_GITHUB_COPILOT_DEVICE_CLIENT_ID;

const scope =
  process.env.NOVA_GITHUB_OAUTH_SCOPE?.trim() || "read:user user:email copilot";
const authDir = process.env.NOVA_COPILOT_AUTH_DIR?.trim() || resolve(homedir(), ".nova");
const authPath = resolve(authDir, "copilot-auth.json");

async function main() {
  const codeResponse = await fetchJson("https://github.com/login/device/code", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json"
    },
    body: new URLSearchParams({
      client_id: clientId,
      scope
    })
  });

  if (!codeResponse.device_code || !codeResponse.user_code || !codeResponse.verification_uri) {
    throw new Error(codeResponse.error_description || codeResponse.error || "device code request failed");
  }

  console.log(`OPEN URL: ${codeResponse.verification_uri}`);
  console.log(`ONE-TIME CODE: ${codeResponse.user_code}`);
  console.log("Waiting for GitHub authorization...");

  const intervalMs = Math.max(2, Number(codeResponse.interval || 5)) * 1000;
  const expiresAt = Date.now() + Number(codeResponse.expires_in || 900) * 1000;

  while (Date.now() < expiresAt) {
    await sleep(intervalMs);
    const tokenResponse = await fetchJson("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json"
      },
      body: new URLSearchParams({
        client_id: clientId,
        device_code: codeResponse.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code"
      })
    });

    if (tokenResponse.access_token) {
      let copilotToken;
      try {
        const copilotResponse = await fetch("https://api.github.com/copilot_internal/v2/token", {
          headers: {
            authorization: `Bearer ${tokenResponse.access_token}`,
            accept: "application/json"
          }
        });
        if (copilotResponse.ok) {
          const body = await copilotResponse.json();
          copilotToken = body?.token;
        }
      } catch {
        // Keep generic GitHub token only if copilot exchange fails.
      }

      mkdirSync(authDir, { recursive: true });
      const previous = readJsonSafe(authPath);
      const next = {
        ...previous,
        provider: "github-copilot",
        githubAccessToken: tokenResponse.access_token,
        copilotToken: copilotToken || previous?.copilotToken || "",
        tokenType: tokenResponse.token_type || "bearer",
        scope: tokenResponse.scope || scope,
        updatedAt: new Date().toISOString()
      };
      writeFileSync(authPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");

      console.log(`AUTHORIZED. Saved auth profile: ${authPath}`);
      return;
    }

    if (tokenResponse.error === "authorization_pending") {
      console.log("Still waiting for authorization...");
      continue;
    }
    if (tokenResponse.error === "slow_down") {
      console.log("GitHub asked to slow down polling.");
      continue;
    }

    throw new Error(tokenResponse.error_description || tokenResponse.error || "device authorization failed");
  }

  throw new Error("Device code expired before authorization completed.");
}

main().catch((error) => {
  console.error(`Login failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exit(1);
});

function readArg(name) {
  const prefixed = `${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefixed)) return arg.slice(prefixed.length);
  }
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return undefined;
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok && payload?.error) return payload;
  if (!response.ok && !payload?.error) {
    throw new Error(`HTTP ${response.status} from ${url}`);
  }
  return payload;
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function readJsonSafe(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}
