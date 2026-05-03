"use client";

import { useEffect, useRef, useState } from "react";
import { Card } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";

export default function VoicePage() {
  const [status, setStatus] = useState<{ enabled?: boolean; wakeWord?: string; command?: string }>({});
  const [phrase, setPhrase] = useState("hey nova");
  const [result, setResult] = useState<unknown>(null);
  const [ttsLine, setTtsLine] = useState("Hello from Nova.");
  const [ttsError, setTtsError] = useState<string | null>(null);
  const [ttsBusy, setTtsBusy] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

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
      <Card className="space-y-2">
        <h2 className="text-lg font-semibold">Orpheus TTS (via agent)</h2>
        <p className="text-xs text-muted">
          Requires <strong>Settings → Learning</strong>: Orpheus enabled with base URL. Audio is synthesized by agent-core (not the browser) and streamed back.
        </p>
        <Input value={ttsLine} onChange={(e) => setTtsLine(e.target.value)} placeholder="Text to speak" />
        {ttsError ? <p className="text-xs text-red-600">{ttsError}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            tone="purple"
            disabled={ttsBusy}
            onClick={async () => {
              setTtsError(null);
              setTtsBusy(true);
              try {
                const response = await fetch("/api/voice/speak-audio", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ text: ttsLine })
                });
                if (!response.ok) {
                  const data = (await response.json().catch(() => ({}))) as { error?: string };
                  setTtsError(data.error ?? `HTTP ${response.status}`);
                  return;
                }
                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                const el = audioRef.current;
                if (el) {
                  el.src = url;
                  await el.play().catch(() => setTtsError("Playback blocked or unsupported in this browser."));
                }
              } catch {
                setTtsError("Request failed");
              } finally {
                setTtsBusy(false);
              }
            }}
          >
            {ttsBusy ? "Synthesizing…" : "Play TTS"}
          </Button>
        </div>
        <audio ref={audioRef} className="mt-2 w-full" controls />
      </Card>
    </div>
  );
}
