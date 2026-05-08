import { describe, expect, it } from "vitest";
import { getAgentBaseUrlDebug } from "./agent-core";

describe("getAgentBaseUrlDebug", () => {
  it("prefers Host when x-forwarded-host is localhost", () => {
    const request = new Request("https://nova/api/auth/state", {
      headers: {
        host: "nova",
        "x-forwarded-host": "127.0.0.1"
      }
    });
    const out = getAgentBaseUrlDebug(request);
    expect(out.baseUrl).toBe("http://nova:8787");
    expect(out.source).toBe("infer_from_host");
    expect(out.usedHeader).toBe("host");
  });

  it("uses explicit env when provided", () => {
    const prev = process.env.NOVA_AGENT_API_URL;
    process.env.NOVA_AGENT_API_URL = "http://example:1234/";
    try {
      const out = getAgentBaseUrlDebug(new Request("https://nova/api/auth/state"));
      expect(out.baseUrl).toBe("http://example:1234");
      expect(out.source).toBe("explicit_env");
    } finally {
      process.env.NOVA_AGENT_API_URL = prev;
    }
  });

  it("rewrites hostname nova to loopback when NOVA_AGENT_API_COLOCATED=1", () => {
    const prevUrl = process.env.NOVA_AGENT_API_URL;
    const prevCol = process.env.NOVA_AGENT_API_COLOCATED;
    process.env.NOVA_AGENT_API_URL = "http://nova:8787";
    process.env.NOVA_AGENT_API_COLOCATED = "1";
    try {
      const out = getAgentBaseUrlDebug(undefined);
      expect(out.baseUrl).toBe("http://127.0.0.1:8787");
      expect(out.source).toBe("explicit_env");
    } finally {
      process.env.NOVA_AGENT_API_URL = prevUrl;
      process.env.NOVA_AGENT_API_COLOCATED = prevCol;
    }
  });
});

