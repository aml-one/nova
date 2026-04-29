"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"loading" | "setup" | "login">("loading");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void (async () => {
      const stateResponse = await fetch("/api/auth/state");
      const stateData = (await stateResponse.json()) as { needsSetup?: boolean; loginEnabled?: boolean };
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
        body: JSON.stringify({ email, password })
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Authentication failed");
        return;
      }
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
      <p>{mode === "setup" ? "Create admin credentials" : "Sign in with your admin credentials"}</p>
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
    </main>
  );
}
