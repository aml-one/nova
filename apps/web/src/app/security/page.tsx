"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Anomaly = {
  type: string;
  severity: string;
  detail: string;
};

type SecurityAnalyzeResult = {
  mode?: string;
  summary?: Record<string, unknown>;
  anomalies?: Anomaly[];
  recommendations?: string[];
};

type SecurityHistoryItem = {
  id: string;
  action: string;
  status: string;
  actor?: string;
  createdAt: string;
  details?: unknown;
};

export default function SecurityPage() {
  const [analyze, setAnalyze] = useState<SecurityAnalyzeResult | null>(null);
  const [history, setHistory] = useState<SecurityHistoryItem[]>([]);
  const [ipToBlock, setIpToBlock] = useState("");
  const [approvalId, setApprovalId] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [simPhone, setSimPhone] = useState("");
  const [simText, setSimText] = useState("");
  const [simChannel, setSimChannel] = useState<"whatsapp" | "signal">("whatsapp");
  const [simResult, setSimResult] = useState<Record<string, unknown> | null>(null);

  async function load(): Promise<void> {
    const [analyzeRes, historyRes] = await Promise.all([fetch("/api/security/analyze"), fetch("/api/security/history")]);
    const analyzeData = (await analyzeRes.json()) as { result?: SecurityAnalyzeResult };
    const historyData = (await historyRes.json()) as { items?: SecurityHistoryItem[] };
    setAnalyze(analyzeData.result ?? null);
    setHistory(historyData.items ?? []);
  }

  useEffect(() => {
    void load();
  }, []);

  async function runAction(payload: { action: "block_ip" | "harden"; ipToBlock?: string }): Promise<void> {
    const response = await fetch("/api/security/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...payload,
        apply: true,
        approvalId: approvalId.trim() || undefined
      })
    });
    const data = (await response.json()) as { approvalRequired?: boolean; approvalId?: string; error?: string };
    if (data.approvalRequired && data.approvalId) {
      setStatus(`Approval required. Approve ID ${data.approvalId} in Approvals, then retry with this approval ID.`);
      setApprovalId(data.approvalId);
    } else if (!response.ok) {
      setStatus(data.error ?? "Action failed");
    } else {
      setStatus("Security action executed");
    }
    await load();
  }

  async function runRoleTest(): Promise<void> {
    const response = await fetch("/api/access/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        channel: simChannel,
        phoneNumber: simPhone,
        text: simText
      })
    });
    const data = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      setStatus(String(data.error ?? "Role test failed"));
      return;
    }
    setSimResult(data);
  }

  return (
    <main style={{ fontFamily: "sans-serif", margin: "2rem auto", maxWidth: 980 }}>
      <h1>Security Center</h1>
      <p>
        <Link href="/dashboard">Dashboard</Link> · <Link href="/settings">Settings</Link>
      </p>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button type="button" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      {status ? <p>{status}</p> : null}

      <section style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, marginBottom: 14 }}>
        <h2>Live Anomalies</h2>
        {(analyze?.anomalies ?? []).length === 0 ? <p>No major anomalies detected.</p> : null}
        <div style={{ display: "grid", gap: 8 }}>
          {(analyze?.anomalies ?? []).map((item, index) => (
            <article key={`${item.type}-${index}`} style={{ border: "1px solid #eee", borderRadius: 6, padding: 10 }}>
              <div>
                <strong>{item.type}</strong> · {item.severity}
              </div>
              <div>{item.detail}</div>
            </article>
          ))}
        </div>
        <h3>Recommendations</h3>
        <ul>
          {(analyze?.recommendations ?? []).map((item, index) => (
            <li key={`${index}-${item}`}>{item}</li>
          ))}
        </ul>
      </section>

      <section style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, marginBottom: 14 }}>
        <h2>One-Click Actions (Approval Gated)</h2>
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr auto auto" }}>
          <input
            value={ipToBlock}
            onChange={(event) => setIpToBlock(event.target.value)}
            placeholder="IP to block (e.g. 203.0.113.5)"
            style={{ padding: 8 }}
          />
          <button type="button" onClick={() => void runAction({ action: "block_ip", ipToBlock })}>
            Block IP
          </button>
          <button type="button" onClick={() => void runAction({ action: "harden" })}>
            Harden Host
          </button>
        </div>
        <input
          value={approvalId}
          onChange={(event) => setApprovalId(event.target.value)}
          placeholder="Optional approved approval ID"
          style={{ marginTop: 8, width: "100%", padding: 8 }}
        />
      </section>

      <section style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, marginBottom: 14 }}>
        <h2>Role Policy Tester</h2>
        <p style={{ marginTop: 0, color: "#555" }}>
          Simulate how a WhatsApp/Signal number is classified and what it can do.
        </p>
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "160px 1fr" }}>
          <select value={simChannel} onChange={(event) => setSimChannel(event.target.value as "whatsapp" | "signal")} style={{ padding: 8 }}>
            <option value="whatsapp">WhatsApp</option>
            <option value="signal">Signal</option>
          </select>
          <input
            value={simPhone}
            onChange={(event) => setSimPhone(event.target.value)}
            placeholder="+15551234567"
            style={{ padding: 8 }}
          />
        </div>
        <input
          value={simText}
          onChange={(event) => setSimText(event.target.value)}
          placeholder="Optional test message (e.g. /run ipconfig)"
          style={{ marginTop: 8, width: "100%", padding: 8 }}
        />
        <button type="button" onClick={() => void runRoleTest()} style={{ marginTop: 8 }}>
          Run Role Test
        </button>
        {simResult ? <pre style={{ marginTop: 8 }}>{JSON.stringify(simResult, null, 2)}</pre> : null}
      </section>

      <section style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
        <h2>Security Audit History</h2>
        <div style={{ display: "grid", gap: 8 }}>
          {history.map((item) => (
            <article key={item.id} style={{ border: "1px solid #eee", borderRadius: 6, padding: 10 }}>
              <div>
                <strong>{item.action}</strong> · {item.status} · {new Date(item.createdAt).toLocaleString()}
              </div>
              <div>Actor: {item.actor ?? "-"}</div>
              {item.details ? <pre style={{ margin: 0 }}>{JSON.stringify(item.details, null, 2)}</pre> : null}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
