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
        <p className="text-xs text-muted">
          Useful if you want hands-free "Hey Nova" activation. If you only use text chat, you can leave this disabled.
        </p>
      </Card>
      <Card>
        <div className="space-y-1 text-sm">
          <div>
            <strong>Status:</strong> {status.enabled ? "Enabled" : "Disabled"}
          </div>
          <div>
            <strong>Wake word:</strong> {status.wakeWord || "-"}
          </div>
          <div>
            <strong>Action:</strong> {status.command || "-"}
          </div>
        </div>
        <details className="mt-2 text-xs text-muted">
          <summary className="cursor-pointer">Show raw status JSON</summary>
          <pre className="mt-2 overflow-x-auto rounded-ui border bg-surface2 p-2">{JSON.stringify(status, null, 2)}</pre>
        </details>
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
      <Card>
        <div className="text-sm text-muted">{result ? "Test complete. Expand for raw response." : "Run a wake-word test to see result."}</div>
        {result ? (
          <details className="mt-2 text-xs text-muted">
            <summary className="cursor-pointer">Show test response JSON</summary>
            <pre className="mt-2 overflow-x-auto rounded-ui border bg-surface2 p-2">{JSON.stringify(result, null, 2)}</pre>
          </details>
        ) : null}
      </Card>
    </div>
  );
}
