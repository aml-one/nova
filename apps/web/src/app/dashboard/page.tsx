"use client";

import { useEffect, useState } from "react";
import { Card } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";

type HistoryRow = {
  run_id: string;
  user_id: string;
  channel: string;
  input_text: string;
  output_text?: string;
  created_at: string;
  first_token_ms?: number;
  tokens_per_second?: number;
};

type UserRow = {
  user_id: string;
  preferred_name?: string;
  preferred_style?: string;
  preferred_persona_id?: string;
  memory_count: number;
};

type CostSummary = {
  spentUsd: number;
  budgetUsd: number;
  remainingUsd: number;
  utilizationPct: number;
  runs: number;
};

type ProviderCostRow = {
  provider: string;
  costUsd: number;
  runs: number;
};

export default function DashboardPage() {
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [costSummary, setCostSummary] = useState<CostSummary | null>(null);
  const [providerCosts, setProviderCosts] = useState<ProviderCostRow[]>([]);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      const [historyRes, usersRes, costRes] = await Promise.all([
        fetch("/api/dashboard/history"),
        fetch("/api/dashboard/users"),
        fetch("/api/dashboard/cost")
      ]);
      const historyData = (await historyRes.json()) as { items: HistoryRow[] };
      const usersData = (await usersRes.json()) as { items: UserRow[] };
      const costData = (await costRes.json()) as { summary?: CostSummary; byProvider?: ProviderCostRow[] };
      setHistory(historyData.items ?? []);
      setUsers(usersData.items ?? []);
      setCostSummary(costData.summary ?? null);
      setProviderCosts(costData.byProvider ?? []);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted">Live overview of users and recent runs.</p>
      </div>
      {loading ? <Card>Loading...</Card> : null}
      <Card>
        <h2 className="mb-3 text-lg font-semibold">Users</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted">
                <th className="py-2">User</th>
                <th className="py-2">Name</th>
                <th className="py-2">Style</th>
                <th className="py-2">Persona</th>
                <th className="py-2">Memory</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.user_id} className="border-t">
                  <td className="py-2">{user.user_id}</td>
                  <td className="py-2">{user.preferred_name ?? "-"}</td>
                  <td className="py-2">{user.preferred_style ?? "-"}</td>
                  <td className="py-2">{user.preferred_persona_id ?? "-"}</td>
                  <td className="py-2">
                    <Badge tone="purple">{user.memory_count}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card>
        <h2 className="mb-3 text-lg font-semibold">Daily Cost Governor</h2>
        <div className="grid gap-3 md:grid-cols-4">
          <Stat title="Spent" value={`$${(costSummary?.spentUsd ?? 0).toFixed(4)}`} />
          <Stat title="Budget" value={`$${(costSummary?.budgetUsd ?? 0).toFixed(2)}`} />
          <Stat title="Remaining" value={`$${(costSummary?.remainingUsd ?? 0).toFixed(4)}`} />
          <Stat title="Utilization" value={`${(costSummary?.utilizationPct ?? 0).toFixed(1)}%`} />
        </div>
        <div className="mt-3 space-y-1 text-sm">
          {providerCosts.length === 0 ? (
            <div className="text-muted">No provider spend tracked today.</div>
          ) : (
            providerCosts.map((row) => (
              <div key={row.provider} className="flex items-center justify-between rounded-ui border bg-surface px-2 py-1">
                <span>{row.provider}</span>
                <span>${row.costUsd.toFixed(4)} · {row.runs} runs</span>
              </div>
            ))
          )}
        </div>
      </Card>
      <Card>
        <h2 className="mb-3 text-lg font-semibold">Streaming Performance</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <MiniBarChart
            title="First Token Latency (ms)"
            values={history.slice(0, 20).map((item) => Number(item.first_token_ms ?? 0)).filter((n) => n > 0)}
            tone="blue"
          />
          <MiniBarChart
            title="Tokens / Second"
            values={history.slice(0, 20).map((item) => Number(item.tokens_per_second ?? 0)).filter((n) => n > 0)}
            tone="green"
          />
        </div>
      </Card>
      <Card>
        <h2 className="mb-3 text-lg font-semibold">Recent Runs</h2>
        <div className="space-y-2">
          {history.slice(0, 20).map((row) => (
            <article key={row.run_id} className="rounded-ui border bg-surface px-3 py-2">
              <div className="mb-1 text-xs text-muted">{row.channel} • {row.user_id}</div>
              <div className="text-sm"><strong>Input:</strong> {row.input_text}</div>
              <div className="text-sm"><strong>Output:</strong> {row.output_text ?? "-"}</div>
              <div className="text-xs text-muted">
                first token: {row.first_token_ms ?? "-"}ms · t/s: {row.tokens_per_second?.toFixed?.(2) ?? "-"}
              </div>
            </article>
          ))}
        </div>
      </Card>
    </div>
  );
}

function Stat({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-ui border bg-surface p-2">
      <div className="text-xs text-muted">{title}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function MiniBarChart({ title, values, tone }: { title: string; values: number[]; tone: "blue" | "green" }) {
  const max = Math.max(1, ...values);
  const color = tone === "blue" ? "bg-pastelBlue border-blue-500/70" : "bg-pastelGreen border-green-500/70";
  return (
    <div className="rounded-ui border bg-surface p-3">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {values.length === 0 ? (
        <p className="text-xs text-muted">No data yet.</p>
      ) : (
        <div className="flex h-24 items-end gap-1">
          {values.map((value, index) => (
            <div
              key={`${title}-${index}`}
              className={`w-full rounded-t-ui border ${color}`}
              style={{ height: `${Math.max(6, (value / max) * 100)}%` }}
              title={value.toFixed(2)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
