"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import { Button } from "../../../components/ui/button";
import { apiFetch } from "../../../lib/api-fetch";

type PersonRecord = {
  id: string;
  displayName?: string;
  rating: number;
  interestScore: number;
  rudenessScore: number;
  preferredChannel?: "web" | "signal" | "whatsapp";
  topics: string[];
  optedOut: boolean;
  blocked: boolean;
  updatedAt?: string;
};

export default function PeopleAdminPage() {
  const [items, setItems] = useState<PersonRecord[]>([]);
  const [error, setError] = useState<string>("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await apiFetch("/api/admin/people?limit=500");
        const data = (await res.json()) as { items?: PersonRecord[]; error?: string };
        if (!res.ok) throw new Error(data.error ?? "failed to load");
        if (!cancelled) setItems(data.items ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return items;
    return items.filter((p) => {
      const name = (p.displayName ?? "").toLowerCase();
      return name.includes(t) || p.id.toLowerCase().includes(t) || (p.topics ?? []).join(" ").toLowerCase().includes(t);
    });
  }, [items, q]);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people (name, id, topics)..." />
        </div>
        <Button onClick={() => location.reload()} variant="secondary">
          Refresh
        </Button>
      </div>

      {error ? <Card className="p-4 border-red-400/40 text-red-200">{error}</Card> : null}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {loading ? (
          <Card className="p-4">Loading…</Card>
        ) : filtered.length === 0 ? (
          <Card className="p-4">No people found.</Card>
        ) : (
          filtered.map((p) => (
            <Card key={p.id} className="p-4 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold truncate">{p.displayName ?? "(unnamed)"}</div>
                  <div className="text-xs opacity-70 truncate">{p.id}</div>
                </div>
                <Link href={`/admin/people/${encodeURIComponent(p.id)}`}>
                  <Button size="sm">Open</Button>
                </Link>
              </div>
              <div className="text-sm opacity-90 flex flex-wrap gap-2">
                <span>Rating: {p.rating}</span>
                <span>Interest: {Math.round((p.interestScore ?? 0) * 100)}%</span>
                <span>Rude: {Math.round((p.rudenessScore ?? 0) * 100)}%</span>
                <span>Pref: {p.preferredChannel ?? "—"}</span>
              </div>
              <div className="text-xs opacity-75">
                {p.blocked ? "Blocked" : p.optedOut ? "Opted out" : "OK"} • Topics: {(p.topics ?? []).slice(0, 6).join(", ") || "—"}
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

