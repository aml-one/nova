"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clearAgentRestartExpected, isAgentRestartGraceActive } from "../../lib/agent-restart-grace";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"loading" | "setup" | "login">("loading");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [agentUnreachable, setAgentUnreachable] = useState(false);

  useEffect(() => {
    void (async () => {
      const stateResponse = await fetch("/api/auth/state");
      const stateData = (await stateResponse.json()) as {
        needsSetup?: boolean;
        loginEnabled?: boolean;
        agentUnreachable?: boolean;
      };
      if (stateData.agentUnreachable && isAgentRestartGraceActive()) {
        setAgentUnreachable(false);
      } else if (stateData.agentUnreachable) {
        setAgentUnreachable(true);
      }
      if (!stateData.agentUnreachable) {
        clearAgentRestartExpected();
      }
      if (stateData.loginEnabled === false) {
        router.push("/dashboard");
        return;
      }
      setMode(stateData.needsSetup ? "setup" : "login");
    })();
  }, [router]);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const endpoint = mode === "setup" ? "/api/auth/setup" : "/api/auth/login";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email, password })
      });
      let data: { error?: string };
      try {
        data = (await response.json()) as { error?: string };
      } catch {
        setError(response.ok ? "Unexpected response from server" : `Login failed (${response.status})`);
        return;
      }
      if (!response.ok || data.error) {
        setError(data.error ?? "Authentication failed");
        return;
      }
      router.refresh();
      router.push("/dashboard");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ fontFamily: "sans-serif", margin: "4rem auto", maxWidth: 460 }}>
      <h1>Nova Access</h1>
      <p style={{ marginTop: -6, color: "#666" }}>Nova by AmL</p>
      <p>{mode === "setup" ? "Create admin credentials" : "Sign in with your admin credentials"}</p>
      {agentUnreachable ? (
        <p style={{ marginTop: 10, color: "#856404", fontSize: 13, background: "#fff3cd", padding: "8px 10px", borderRadius: 6 }}>
          Nova could not read auth settings from the agent (check <code>NOVA_AGENT_API_URL</code> and that agent-core is running).
          Login is required until the agent responds. To temporarily open the UI, set{" "}
          <code>NOVA_WEB_LOGIN_ENABLED=false</code> on the web server (homelab only).
        </p>
      ) : null}
      <form onSubmit={onSubmit} style={{ display: "grid", gap: 10, marginTop: 16 }}>
        <input
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Email"
          style={{ padding: 10 }}
        />
        <input
          type="password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Password"
          style={{ padding: 10 }}
        />
        <button type="submit" disabled={loading || mode === "loading"} style={{ padding: "10px 14px" }}>
          {loading ? "Please wait..." : mode === "setup" ? "Create Admin Account" : "Sign In"}
        </button>
      </form>
      {error ? <p style={{ color: "#b00020", marginTop: 12 }}>{error}</p> : null}
      <p style={{ marginTop: 18, color: "#666", fontSize: 12 }}>Nova - Made by AmL</p>
    </main>
  );
}
