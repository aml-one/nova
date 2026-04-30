"use client";

import { useEffect, useState } from "react";
import { Card } from "../../components/ui/card";
import { Button } from "../../components/ui/button";

export default function ReportsPage() {
  const [weekly, setWeekly] = useState<{ summary?: Record<string, unknown>; items?: unknown[] }>({});
  const [digest, setDigest] = useState<{ summary?: Record<string, unknown>; items?: unknown[] }>({});

  async function load(): Promise<void> {
    const [w, d] = await Promise.all([
      fetch("/api/reports/learning/weekly"),
      fetch("/api/security/digest/overnight")
    ]);
    setWeekly(await w.json());
    setDigest(await d.json());
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="space-y-4">
      <Card className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Reports</h1>
          <p className="text-sm text-muted">Weekly learning report and overnight anomaly digest.</p>
        </div>
        <Button type="button" tone="blue" onClick={() => void load()}>Refresh</Button>
      </Card>
      <Card>
        <h2 className="mb-2 text-lg font-semibold">Weekly Learning</h2>
        <pre className="overflow-x-auto text-xs">{JSON.stringify(weekly.summary ?? {}, null, 2)}</pre>
      </Card>
      <Card>
        <h2 className="mb-2 text-lg font-semibold">Overnight Security Digest</h2>
        <pre className="overflow-x-auto text-xs">{JSON.stringify(digest.summary ?? {}, null, 2)}</pre>
      </Card>
    </div>
  );
}
