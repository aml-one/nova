"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card } from "../../components/ui/card";
import {
  IdentityEvolutionGraph,
  buildIdentityTimeline,
  type ImprovementHistoryByDate,
  type TimelineFilterKey
} from "../../components/identity-evolution-graph";

type PersonaState = {
  id: string;
  voice: string;
  style: string[];
  systemPrompt: string;
};
type PersonaVersion = { version: number; createdAt: string };
type BackupRunState = { status?: "success" | "failed"; createdAt?: string; branch?: string; error?: string } | null;

export default function IdentityEvolutionPage() {
  const [loading, setLoading] = useState(true);
  const [defaultPersona, setDefaultPersona] = useState<PersonaState>({
    id: "default",
    voice: "helpful",
    style: ["direct", "clear"],
    systemPrompt: ""
  });
  const [personaVersions, setPersonaVersions] = useState<PersonaVersion[]>([]);
  const [improvementHistoryByDate, setImprovementHistoryByDate] = useState<ImprovementHistoryByDate>({});
  const [latestIdentityBackup, setLatestIdentityBackup] = useState<BackupRunState>(null);
  const [timelineFilters, setTimelineFilters] = useState<Record<TimelineFilterKey, boolean>>({
    persona: true,
    knowledge: true,
    backup: true
  });

  useEffect(() => {
    void (async () => {
      setLoading(true);
      await Promise.all([loadDefaultPersona(), loadPersonaVersions(), loadImprovementHistory(), loadIdentityBackupStatus()]);
      setLoading(false);
    })();
  }, []);

  async function loadDefaultPersona(): Promise<void> {
    const response = await fetch("/api/persona/default");
    const data = (await response.json()) as { persona?: PersonaState };
    if (!response.ok || !data.persona) return;
    setDefaultPersona({
      id: data.persona.id || "default",
      voice: data.persona.voice || "helpful",
      style: Array.isArray(data.persona.style) ? data.persona.style : [],
      systemPrompt: data.persona.systemPrompt || ""
    });
  }

  async function loadPersonaVersions(): Promise<void> {
    const response = await fetch("/api/personas/versions?personaId=default&rewritesOnly=true");
    const data = (await response.json()) as { items?: PersonaVersion[] };
    if (response.ok) {
      setPersonaVersions(Array.isArray(data.items) ? data.items : []);
    }
  }

  async function loadImprovementHistory(): Promise<void> {
    const response = await fetch("/api/improvement/history");
    const data = (await response.json()) as { itemsByDate?: ImprovementHistoryByDate };
    if (response.ok) {
      setImprovementHistoryByDate(data.itemsByDate ?? {});
    }
  }

  async function loadIdentityBackupStatus(): Promise<void> {
    const response = await fetch("/api/backup/identity/status");
    const data = (await response.json()) as { latestSuccess?: BackupRunState; latestRun?: BackupRunState };
    if (response.ok) {
      setLatestIdentityBackup(data.latestSuccess ?? data.latestRun ?? null);
    }
  }

  const identityTimeline = useMemo(
    () =>
      buildIdentityTimeline({
        defaultPersona,
        versions: personaVersions,
        improvementHistoryByDate,
        latestIdentityBackup
      }),
    [defaultPersona, personaVersions, improvementHistoryByDate, latestIdentityBackup]
  );

  return (
    <div className="space-y-4">
      <Card className="space-y-2">
        <h1 className="text-2xl font-semibold">Identity evolution</h1>
        <p className="text-sm text-muted">
          Same timeline as in Settings → Identity, without restore actions. Edit base persona and run restores from{" "}
          <Link href="/settings" className="text-sky-500 underline hover:text-sky-400">
            Settings
          </Link>
          .
        </p>
      </Card>
      {loading ? <Card>Loading timeline…</Card> : null}
      {!loading ? (
        <Card className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold">Identity Evolution Graph</h2>
            <p className="text-xs text-muted">Bottom is Awakening. Top is Present. Personality, learning activity, and backup milestones.</p>
          </div>
          <IdentityEvolutionGraph
            hideRestore
            items={identityTimeline}
            filters={timelineFilters}
            onToggleFilter={(key) => setTimelineFilters((prev) => ({ ...prev, [key]: !prev[key] }))}
          />
        </Card>
      ) : null}
    </div>
  );
}
