"use client";

import { useEffect, useRef, useState } from "react";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { triggerBlobDownload } from "../lib/audio-download";
import { loadAudioElementThenPlay } from "../lib/audio-play";

/** Wake-word bridge status and tests (Settings → Voice). */
export function VoiceWakeWordPanel() {
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
        <h3 className="text-sm font-semibold">Wake-word bridge</h3>
        <p className="mt-1 text-xs text-muted">Optional hands-free trigger. Disable if you only use text chat.</p>
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
          Test wake-word
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

/** Local TTS playback test using current agent Orpheus settings. */
export function OrpheusTtsPreviewCard() {
  const [ttsLine, setTtsLine] = useState("Hello from Nova.");
  const [ttsError, setTtsError] = useState<string | null>(null);
  const [ttsBusy, setTtsBusy] = useState(false);
  const [lastClip, setLastClip] = useState<{ blob: Blob; mime: string } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  return (
    <Card className="space-y-2">
      <h3 className="text-sm font-semibold">Play test clip</h3>
      <p className="text-xs text-muted">Uses the Orpheus settings above. Save Settings first if you changed the server URL.</p>
      <Input value={ttsLine} onChange={(e) => setTtsLine(e.target.value)} placeholder="Text to speak" />
      {ttsError ? <p className="text-xs text-red-600">{ttsError}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
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
              const mime = response.headers.get("content-type") ?? "audio/wav";
              setLastClip({ blob: blob.slice(), mime });
              const url = URL.createObjectURL(blob);
              const el = audioRef.current;
              if (el) {
                el.src = url;
                await loadAudioElementThenPlay(el).catch(() =>
                  setTtsError("Playback blocked or unsupported in this browser.")
                );
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
        <Button
          type="button"
          tone="neutral"
          disabled={ttsBusy || !lastClip}
          title="Save the last synthesized clip"
          onClick={() => {
            if (!lastClip) return;
            triggerBlobDownload(lastClip.blob, lastClip.mime, `nova-voice-preview-${Date.now().toString(36)}`);
          }}
        >
          Download
        </Button>
      </div>
      <audio ref={audioRef} className="mt-2 w-full" controls />
    </Card>
  );
}
