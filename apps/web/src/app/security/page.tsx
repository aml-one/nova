"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Select } from "../../components/ui/select";

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
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Security Center</h1>
        <p className="text-sm text-muted">
          <Link href="/settings" className="underline">Open Settings</Link>
        </p>
      </div>
      <div className="flex gap-2">
        <Button type="button" tone="orange" onClick={() => void load()}>
          Refresh
        </Button>
      </div>
      {status ? <Card>{status}</Card> : null}

      <Card>
        <h2 className="mb-2 text-lg font-semibold">Live Anomalies</h2>
        {(analyze?.anomalies ?? []).length === 0 ? <p>No major anomalies detected.</p> : null}
        <div className="grid gap-2">
          {(analyze?.anomalies ?? []).map((item, index) => (
            <article key={`${item.type}-${index}`} className="rounded-ui border bg-surface p-3">
              <div>
                <strong>{item.type}</strong> · {item.severity}
              </div>
              <div>{item.detail}</div>
            </article>
          ))}
        </div>
        <h3 className="mt-3 font-semibold">Recommendations</h3>
        <ul>
          {(analyze?.recommendations ?? []).map((item, index) => (
            <li key={`${index}-${item}`}>{item}</li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2 className="mb-2 text-lg font-semibold">One-Click Actions</h2>
        <div className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
          <Input
            value={ipToBlock}
            onChange={(event) => setIpToBlock(event.target.value)}
            placeholder="IP to block (e.g. 203.0.113.5)"
          />
          <Button type="button" tone="red" onClick={() => void runAction({ action: "block_ip", ipToBlock })}>
            Block IP
          </Button>
          <Button type="button" tone="yellow" onClick={() => void runAction({ action: "harden" })}>
            Harden Host
          </Button>
        </div>
        <Input
          value={approvalId}
          onChange={(event) => setApprovalId(event.target.value)}
          placeholder="Optional approved approval ID"
          className="mt-2"
        />
      </Card>

      <Card>
        <h2 className="mb-1 text-lg font-semibold">Role Policy Tester</h2>
        <p className="text-sm text-muted">
          Simulate how a WhatsApp/Signal number is classified and what it can do.
        </p>
        <div className="grid gap-2 md:grid-cols-[160px_1fr]">
          <Select value={simChannel} onChange={(event) => setSimChannel(event.target.value as "whatsapp" | "signal")}>
            <option value="whatsapp">WhatsApp</option>
            <option value="signal">Signal</option>
          </Select>
          <Input
            value={simPhone}
            onChange={(event) => setSimPhone(event.target.value)}
            placeholder="+15551234567"
          />
        </div>
        <Input
          value={simText}
          onChange={(event) => setSimText(event.target.value)}
          placeholder="Optional test message (e.g. /run ipconfig)"
          className="mt-2"
        />
        <Button type="button" tone="pink" onClick={() => void runRoleTest()} className="mt-2">
          Run Role Test
        </Button>
        {simResult ? <pre className="mt-2 overflow-x-auto text-xs">{JSON.stringify(simResult, null, 2)}</pre> : null}
      </Card>

      <Card>
        <h2 className="mb-2 text-lg font-semibold">Security Audit History</h2>
        <div className="grid gap-2">
          {history.map((item) => (
            <article key={item.id} className="rounded-ui border bg-surface p-3">
              <div>
                <strong>{item.action}</strong> · {item.status} · {new Date(item.createdAt).toLocaleString()}
              </div>
              <div>Actor: {item.actor ?? "-"}</div>
              {item.details ? <pre className="m-0 overflow-x-auto text-xs">{JSON.stringify(item.details, null, 2)}</pre> : null}
            </article>
          ))}
        </div>
      </Card>
    </div>
  );
}
