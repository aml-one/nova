"use client";

import { useState } from "react";
import { Card } from "../../components/ui/card";
import { Textarea } from "../../components/ui/textarea";
import { Button } from "../../components/ui/button";

export default function SandboxPage() {
  const [command, setCommand] = useState("");
  const [result, setResult] = useState<unknown>(null);

  return (
    <div className="space-y-4">
      <Card>
        <h1 className="text-2xl font-semibold">Sandbox Simulation</h1>
        <p className="text-sm text-muted">Preview risky commands without executing them.</p>
        <p className="text-xs text-muted">
          Use this as a safety check before allowing real command execution. It estimates side effects and risk without making changes.
        </p>
      </Card>
      <Card className="space-y-2">
        <Textarea rows={4} value={command} onChange={(e) => setCommand(e.target.value)} placeholder="Command to simulate..." />
        <Button
          type="button"
          tone="yellow"
          onClick={async () => {
            const response = await fetch("/api/sandbox/simulate", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ command })
            });
            const data = await response.json();
            setResult(data.simulation ?? data.error ?? null);
          }}
        >
          Simulate
        </Button>
      </Card>
      <Card>
        <pre className="overflow-x-auto text-xs">{JSON.stringify(result, null, 2)}</pre>
      </Card>
    </div>
  );
}
