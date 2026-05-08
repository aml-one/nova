"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Card } from "../../../../components/ui/card";
import { Button } from "../../../../components/ui/button";
import { Input } from "../../../../components/ui/input";
import { Textarea } from "../../../../components/ui/textarea";
import { Checkbox } from "../../../../components/ui/checkbox";
import { Select } from "../../../../components/ui/select";
import { apiFetch } from "../../../../lib/api-fetch";

type PersonRecord = {
  id: string;
  displayName?: string;
  aboutNotes?: string;
  rating: number;
  interestScore: number;
  rudenessScore: number;
  preferredChannel?: "web" | "signal" | "whatsapp";
  topics: string[];
  optedOut: boolean;
  blocked: boolean;
};

type IdentityRecord = { id: number; kind: string; value: string; createdAt?: string };

export default function PersonAdminDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = decodeURIComponent(params.id);

  const [item, setItem] = useState<PersonRecord | null>(null);
  const [identities, setIdentities] = useState<IdentityRecord[]>([]);
  const [lockedFields, setLockedFields] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    displayName: "",
    aboutNotes: "",
    rating: 50,
    interestScore: 0.5,
    rudenessScore: 0,
    preferredChannel: "" as "" | "web" | "signal" | "whatsapp",
    topicsCsv: "",
    optedOut: false,
    blocked: false
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setError("");
      const res = await apiFetch(`/api/admin/people?id=${encodeURIComponent(id)}`);
      const data = (await res.json()) as {
        item?: PersonRecord;
        identities?: IdentityRecord[];
        lockedFields?: string[];
        error?: string;
      };
      if (!res.ok) {
        if (!cancelled) setError(data.error ?? "failed to load");
        return;
      }
      const p = data.item ?? null;
      if (!cancelled) {
        setItem(p);
        setIdentities(data.identities ?? []);
        setLockedFields(data.lockedFields ?? []);
        if (p) {
          setForm({
            displayName: p.displayName ?? "",
            aboutNotes: p.aboutNotes ?? "",
            rating: p.rating ?? 50,
            interestScore: p.interestScore ?? 0.5,
            rudenessScore: p.rudenessScore ?? 0,
            preferredChannel: (p.preferredChannel ?? "") as any,
            topicsCsv: (p.topics ?? []).join(", "),
            optedOut: Boolean(p.optedOut),
            blocked: Boolean(p.blocked)
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const topics = useMemo(() => {
    return form.topicsCsv
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
      .slice(0, 200);
  }, [form.topicsCsv]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!item) return;
    setSaving(true);
    setError("");
    try {
      const res = await apiFetch("/api/admin/people", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: item.id,
          patch: {
            displayName: form.displayName.trim() || null,
            aboutNotes: form.aboutNotes.trim() || null,
            rating: Number(form.rating),
            interestScore: Number(form.interestScore),
            rudenessScore: Number(form.rudenessScore),
            preferredChannel: form.preferredChannel || null,
            topics,
            optedOut: Boolean(form.optedOut),
            blocked: Boolean(form.blocked)
          },
          locks: [
            { field: "displayName", locked: lockedFields.includes("displayName") },
            { field: "aboutNotes", locked: lockedFields.includes("aboutNotes") },
            { field: "rating", locked: lockedFields.includes("rating") },
            { field: "interestScore", locked: lockedFields.includes("interestScore") },
            { field: "rudenessScore", locked: lockedFields.includes("rudenessScore") },
            { field: "preferredChannel", locked: lockedFields.includes("preferredChannel") },
            { field: "topics", locked: lockedFields.includes("topics") }
          ]
        })
      });
      const data = (await res.json()) as { item?: PersonRecord; error?: string };
      if (!res.ok) throw new Error(data.error ?? "save failed");
      setItem(data.item ?? item);
      router.refresh();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  async function addIdentity(kind: string, value: string) {
    if (!item) return;
    setError("");
    const res = await apiFetch("/api/admin/people/identities", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "add", personId: item.id, kind, value })
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok) {
      setError(data.error ?? "identity add failed");
      return;
    }
    // Reload
    const refreshed = await apiFetch(`/api/admin/people?id=${encodeURIComponent(id)}`);
    const d2 = (await refreshed.json()) as { identities?: IdentityRecord[]; lockedFields?: string[]; item?: PersonRecord };
    if (refreshed.ok) {
      setIdentities(d2.identities ?? []);
      setLockedFields(d2.lockedFields ?? []);
      setItem(d2.item ?? item);
    }
  }

  const [newKind, setNewKind] = useState("phone_e164");
  const [newValue, setNewValue] = useState("");
  const [mergeSourceId, setMergeSourceId] = useState("");

  function normalizeMergePersonId(raw: string): string {
    const t = raw.trim().replace(/^\uFEFF/, "");
    const m = t.match(/^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/);
    return m ? m[1].toLowerCase() : t;
  }

  async function mergeFrom(sourceId: string) {
    if (!item) return;
    setError("");
    const sid = normalizeMergePersonId(sourceId);
    const tid = normalizeMergePersonId(item.id);
    const res = await apiFetch("/api/admin/people/merge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceId: sid, targetId: tid })
    });
    const data = (await res.json()) as { ok?: boolean; error?: string; conflicts?: Array<{ kind: string; value: string }> };
    if (!res.ok) {
      setError(data.error ?? "merge failed");
      return;
    }
    if ((data.conflicts ?? []).length > 0) {
      setError(`Merged, but some identities conflicted: ${(data.conflicts ?? []).map((c) => `${c.kind}:${c.value}`).join(", ")}`);
    }
    // Reload
    const refreshed = await apiFetch(`/api/admin/people?id=${encodeURIComponent(id)}`);
    const d2 = (await refreshed.json()) as { identities?: IdentityRecord[]; lockedFields?: string[]; item?: PersonRecord };
    if (refreshed.ok) {
      setIdentities(d2.identities ?? []);
      setLockedFields(d2.lockedFields ?? []);
      setItem(d2.item ?? item);
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-4">
      <div className="flex items-center justify-between">
        <Link href="/admin/people">
          <Button tone="neutral">Back</Button>
        </Link>
        <div className="text-xs opacity-70">{id}</div>
      </div>

      {error ? <Card className="p-4 border-red-400/40 text-red-200">{error}</Card> : null}

      {!item ? (
        <Card className="p-4">Loading…</Card>
      ) : (
        <form onSubmit={save} className="space-y-4">
          <Card className="p-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <div className="text-sm mb-1">Display name</div>
                <Input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
                <div className="mt-2 flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={lockedFields.includes("displayName")}
                    onChange={(e) =>
                      setLockedFields((cur) =>
                        e.target.checked ? Array.from(new Set([...cur, "displayName"])) : cur.filter((x) => x !== "displayName")
                      )
                    }
                  />
                  <span className="opacity-80">Lock</span>
                </div>
              </div>
              <div>
                <div className="text-sm mb-1">Preferred channel</div>
                <Select
                  value={form.preferredChannel}
                  onChange={(e) => setForm({ ...form, preferredChannel: (e.target.value as any) || "" })}
                >
                  <option value="">—</option>
                  <option value="web">WebUI</option>
                  <option value="signal">Signal</option>
                  <option value="whatsapp">WhatsApp</option>
                </Select>
                <div className="mt-2 flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={lockedFields.includes("preferredChannel")}
                    onChange={(e) =>
                      setLockedFields((cur) =>
                        e.target.checked ? Array.from(new Set([...cur, "preferredChannel"])) : cur.filter((x) => x !== "preferredChannel")
                      )
                    }
                  />
                  <span className="opacity-80">Lock</span>
                </div>
              </div>
            </div>

            <div>
              <div className="text-sm mb-1">About / notes</div>
              <Textarea value={form.aboutNotes} onChange={(e) => setForm({ ...form, aboutNotes: e.target.value })} rows={4} />
              <div className="mt-2 flex items-center gap-2 text-sm">
                <Checkbox
                  checked={lockedFields.includes("aboutNotes")}
                  onChange={(e) =>
                    setLockedFields((cur) =>
                      e.target.checked ? Array.from(new Set([...cur, "aboutNotes"])) : cur.filter((x) => x !== "aboutNotes")
                    )
                  }
                />
                <span className="opacity-80">Lock</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <div className="text-sm mb-1">Rating (0-100)</div>
                <Input
                  type="number"
                  value={form.rating}
                  onChange={(e) => setForm({ ...form, rating: Number(e.target.value) })}
                  min={0}
                  max={100}
                />
                <div className="mt-2 flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={lockedFields.includes("rating")}
                    onChange={(e) =>
                      setLockedFields((cur) => (e.target.checked ? Array.from(new Set([...cur, "rating"])) : cur.filter((x) => x !== "rating")))
                    }
                  />
                  <span className="opacity-80">Lock</span>
                </div>
              </div>
              <div>
                <div className="text-sm mb-1">Interest (0-1)</div>
                <Input
                  type="number"
                  step="0.01"
                  value={form.interestScore}
                  onChange={(e) => setForm({ ...form, interestScore: Number(e.target.value) })}
                  min={0}
                  max={1}
                />
                <div className="mt-2 flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={lockedFields.includes("interestScore")}
                    onChange={(e) =>
                      setLockedFields((cur) =>
                        e.target.checked ? Array.from(new Set([...cur, "interestScore"])) : cur.filter((x) => x !== "interestScore")
                      )
                    }
                  />
                  <span className="opacity-80">Lock</span>
                </div>
              </div>
              <div>
                <div className="text-sm mb-1">Rudeness (0-1)</div>
                <Input
                  type="number"
                  step="0.01"
                  value={form.rudenessScore}
                  onChange={(e) => setForm({ ...form, rudenessScore: Number(e.target.value) })}
                  min={0}
                  max={1}
                />
                <div className="mt-2 flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={lockedFields.includes("rudenessScore")}
                    onChange={(e) =>
                      setLockedFields((cur) =>
                        e.target.checked ? Array.from(new Set([...cur, "rudenessScore"])) : cur.filter((x) => x !== "rudenessScore")
                      )
                    }
                  />
                  <span className="opacity-80">Lock</span>
                </div>
              </div>
            </div>

            <div>
              <div className="text-sm mb-1">Topics (comma-separated)</div>
              <Input value={form.topicsCsv} onChange={(e) => setForm({ ...form, topicsCsv: e.target.value })} />
              <div className="mt-2 flex items-center gap-2 text-sm">
                <Checkbox
                  checked={lockedFields.includes("topics")}
                  onChange={(e) =>
                    setLockedFields((cur) => (e.target.checked ? Array.from(new Set([...cur, "topics"])) : cur.filter((x) => x !== "topics")))
                  }
                />
                <span className="opacity-80">Lock</span>
              </div>
            </div>

            <div className="flex items-center gap-4 text-sm">
              <label className="flex items-center gap-2">
                <Checkbox checked={form.optedOut} onChange={(e) => setForm({ ...form, optedOut: e.target.checked })} />
                <span>Opted out</span>
              </label>
              <label className="flex items-center gap-2">
                <Checkbox checked={form.blocked} onChange={(e) => setForm({ ...form, blocked: e.target.checked })} />
                <span>Blocked</span>
              </label>
            </div>

            <div className="flex justify-end">
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </Card>

          <Card className="p-4 space-y-3">
            <div className="font-semibold">Identities</div>
            <div className="space-y-2">
              {identities.length === 0 ? (
                <div className="text-sm opacity-70">No identities yet.</div>
              ) : (
                identities.map((it) => (
                  <div key={it.id} className="text-sm flex justify-between gap-3">
                    <div className="min-w-0 truncate">
                      <span className="opacity-70">{it.kind}</span> <span className="font-mono">{it.value}</span>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="flex gap-2 flex-col md:flex-row">
              <Select value={newKind} onChange={(e) => setNewKind(e.target.value)}>
                <option value="phone_e164">phone_e164</option>
                <option value="whatsapp_phone_e164">whatsapp_phone_e164</option>
                <option value="signal_uuid">signal_uuid</option>
                <option value="web_user_id">web_user_id</option>
              </Select>
              <Input value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder="value" />
              <Button
                type="button"
                onClick={() => {
                  const v = newValue.trim();
                  if (!v) return;
                  void addIdentity(newKind, v);
                  setNewValue("");
                }}
                tone="neutral"
              >
                Add
              </Button>
            </div>
          </Card>

          <Card className="p-4 space-y-3">
            <div className="font-semibold">Merge people</div>
            <div className="text-sm opacity-80">
              Move identities/state/events from another person into this one, then delete the source person.
            </div>
            <div className="flex gap-2 flex-col md:flex-row">
              <Input
                value={mergeSourceId}
                onChange={(e) => setMergeSourceId(e.target.value)}
                placeholder="Other person’s UUID (from People list, under the name)"
              />
              <Button
                type="button"
                tone="neutral"
                onClick={() => {
                  const v = mergeSourceId.trim();
                  if (!v) return;
                  void mergeFrom(v);
                  setMergeSourceId("");
                }}
              >
                Merge into this person
              </Button>
            </div>
          </Card>
        </form>
      )}
    </div>
  );
}

