import type { AppSettings } from "../storage/repositories/settings-repository.js";

type MemoryBearEnvelope<T> = { code?: number; data?: T; msg?: string; error?: string };

function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}

function parseEnvelope<T>(json: unknown): T | undefined {
  if (!json || typeof json !== "object") return undefined;
  const env = json as MemoryBearEnvelope<T>;
  if (env.code !== 0) return undefined;
  return env.data;
}

export async function memoryBearResolveDefaultConfigId(baseUrl: string, apiKey: string): Promise<string | undefined> {
  const url = joinUrl(baseUrl, "/v1/memory_config/read_all_config");
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(60_000)
    });
  } catch {
    return undefined;
  }
  const json = (await response.json().catch(() => null)) as unknown;
  if (!json || typeof json !== "object") return undefined;
  const blob = JSON.stringify(json);
  const m = /"config_id"\s*:\s*"([0-9a-fA-F-]{36})"/.exec(blob);
  return m?.[1];
}

export async function memoryBearCreateEndUser(opts: {
  baseUrl: string;
  apiKey: string;
  otherId: string;
  otherName?: string;
}): Promise<{ endUserId: string; memoryConfigId: string } | undefined> {
  const url = joinUrl(opts.baseUrl, "/v1/end_user/create");
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        other_id: opts.otherId,
        other_name: opts.otherName ?? opts.otherId
      }),
      signal: AbortSignal.timeout(60_000)
    });
  } catch {
    return undefined;
  }
  const json = (await response.json().catch(() => null)) as unknown;
  const data = parseEnvelope<{
    id?: string;
    memory_config_id?: string | null;
  }>(json);
  if (!data?.id) return undefined;
  let memoryConfigId = data.memory_config_id?.trim();
  if (!memoryConfigId) {
    memoryConfigId = await memoryBearResolveDefaultConfigId(opts.baseUrl, opts.apiKey);
  }
  if (!memoryConfigId) return undefined;
  return { endUserId: data.id, memoryConfigId };
}

export async function memoryBearReadSync(opts: {
  baseUrl: string;
  apiKey: string;
  endUserId: string;
  configId: string;
  message: string;
  searchSwitch: AppSettings["memoryBear"]["searchSwitch"];
  storageType: AppSettings["memoryBear"]["storageType"];
}): Promise<string | undefined> {
  const url = joinUrl(opts.baseUrl, "/v1/memory/read/sync");
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        end_user_id: opts.endUserId,
        message: opts.message,
        search_switch: opts.searchSwitch,
        config_id: opts.configId,
        storage_type: opts.storageType
      }),
      signal: AbortSignal.timeout(120_000)
    });
  } catch {
    return undefined;
  }
  const json = (await response.json().catch(() => null)) as unknown;
  const data = parseEnvelope<{ answer?: string }>(json);
  const answer = data?.answer?.trim();
  return answer && answer.length > 0 ? answer : undefined;
}

export async function memoryBearWriteSync(opts: {
  baseUrl: string;
  apiKey: string;
  endUserId: string;
  configId: string;
  userText: string;
  assistantText: string;
  storageType: AppSettings["memoryBear"]["storageType"];
}): Promise<boolean> {
  const url = joinUrl(opts.baseUrl, "/v1/memory/write/sync");
  const message = [
    { role: "user", content: opts.userText },
    { role: "assistant", content: opts.assistantText }
  ];
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        end_user_id: opts.endUserId,
        message,
        config_id: opts.configId,
        storage_type: opts.storageType
      }),
      signal: AbortSignal.timeout(120_000)
    });
  } catch {
    return false;
  }
  const json = (await response.json().catch(() => null)) as unknown;
  const env = json as MemoryBearEnvelope<unknown>;
  return response.ok && env.code === 0;
}
