"use client";

import { useEffect, useState } from "react";
import { Card } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";

export default function VoicePage() {
  const [status, setStatus] = useState<{ enabled?: boolean; wakeWord?: string; command?: string }>({});
  const [phrase, setPhrase] = useState("hey nova");
  const [result, setResult] = useState<unknown>(null);

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/voice/wake-word/status");
      const data = await response.json();
      if (response.ok) setStatus(data);
    })();
  }, []);

  return (
    <div className="space-y-4">
      <Card>
        <h1 className="text-2xl font-semibold">Wake-word Bridge</h1>
        <p className="text-sm text-muted">Optional on-device always-listening trigger bridge.</p>
      </Card>
      <Card>
        <pre className="text-xs">{JSON.stringify(status, null, 2)}</pre>
      </Card>
      <Card className="space-y-2">
        <Input value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder="Test phrase" />
        <Button
          type="button"
          tone="blue"
          onClick={async () => {
            const response = await fetch("/api/voice/wake-word/test", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ phrase })
            });
            setResult(await response.json());
          }}
        >
          Test Wake-word
        </Button>
      </Card>
      <Card><pre className="text-xs">{JSON.stringify(result, null, 2)}</pre></Card>
    </div>
  );
}
