"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FaMicrophone } from "react-icons/fa6";
import { ChatMarkdown } from "../../components/chat-markdown";
import { NovaThreeSpeakingOrb, type NovaThreeSpeakingOrbHandle } from "../../components/NovaThreeSpeakingOrb";
import type { VoiceOrbPresetName } from "../../lib/nova-reactive-orb/NovaReactiveOrb2D";
import { apiFetch } from "../../lib/api-fetch";
import { splitTextForTts, stripMarkdownForTts } from "../../lib/chat-tts-text";
import { loadAudioElementThenPlay } from "../../lib/audio-play";
import { TtsVoiceOrbDriver } from "../../lib/tts-voice-orb-driver";
import { cn } from "../../lib/cn";

const NOVA_KIOSK_STT_MIN_BYTES = 900;

export default function KioskPage() {
  const [markdown, setMarkdown] = useState("");
  const [sttError, setSttError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const orbRef = useRef<NovaThreeSpeakingOrbHandle | null>(null);
  const kioskTtsOrbDriver = useMemo(
    () =>
      new TtsVoiceOrbDriver({
        getOrb: () => orbRef.current,
        getMeter: () => null,
        getEmotionLabel: () => "neutral",
        requireMeterForAttach: false,
        enableMoodFromEmotion: false,
        enablePeriodicDirectionFlip: true
      }),
    []
  );
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  useEffect(() => {
    const ping = (): void => {
      void apiFetch("/api/kiosk/ping", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      });
    };
    void ping();
    const id = setInterval(ping, 8000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => () => kioskTtsOrbDriver.teardownAudioGraph(), [kioskTtsOrbDriver]);

  const playTts = useCallback(async (ttsText: string) => {
    const el = audioRef.current;
    if (!el) return;
    const chunks = splitTextForTts(ttsText);
    if (chunks.length === 0) return;

    setTtsPlaying(true);
    const revoke = () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };

    try {
      for (const piece of chunks) {
        const response = await apiFetch("/api/voice/speak-audio", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: piece })
        });
        if (!response.ok) break;
        const blob = await response.blob();
        revoke();
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        el.src = url;
        el.onplaying = () => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => kioskTtsOrbDriver.attach(el));
          });
        };
        try {
          await loadAudioElementThenPlay(el);
          await new Promise<void>((resolve, reject) => {
            const done = () => {
              el.removeEventListener("ended", done);
              el.removeEventListener("error", err);
              resolve();
            };
            const err = () => {
              el.removeEventListener("ended", done);
              el.removeEventListener("error", err);
              reject(new Error("playback"));
            };
            el.addEventListener("ended", done, { once: true });
            el.addEventListener("error", err, { once: true });
          });
        } catch {
          break;
        } finally {
          kioskTtsOrbDriver.stopDriving();
        }
      }
    } finally {
      revoke();
      kioskTtsOrbDriver.stopDriving();
      setTtsPlaying(false);
    }
  }, [kioskTtsOrbDriver]);

  useEffect(() => {
    const es = new EventSource("/api/kiosk/events");
    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as { type?: string; markdown?: string; ttsText?: string };
        if (msg.type === "assistant_delta" && typeof msg.markdown === "string") {
          setMarkdown(msg.markdown);
        }
        if (msg.type === "assistant_output") {
          if (typeof msg.markdown === "string") {
            setMarkdown(msg.markdown);
          }
          if (typeof msg.ttsText === "string" && msg.ttsText.trim()) {
            void playTts(msg.ttsText);
          }
        }
      } catch {
        /* ignore malformed */
      }
    };
    return () => es.close();
  }, [playTts]);

  const stopRecorder = useCallback(() => {
    const rec = recorderRef.current;
    if (!rec) return;
    try {
      if (rec.state !== "inactive") rec.stop();
    } catch {
      setListening(false);
      recorderRef.current = null;
    }
  }, []);

  const startRecorder = useCallback(async () => {
    setSttError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data?.size) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        recorderRef.current = null;
        setListening(false);
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        chunksRef.current = [];
        if (blob.size < NOVA_KIOSK_STT_MIN_BYTES) {
          setSttError("No speech detected.");
          return;
        }
        void (async () => {
          setThinking(true);
          try {
            const form = new FormData();
            form.append("audio", blob, `kiosk-${Date.now()}.webm`);
            const tr = await apiFetch("/api/voice/transcribe-audio", { method: "POST", body: form });
            const td = (await tr.json().catch(() => ({}))) as { text?: string; error?: string };
            if (!tr.ok) {
              setSttError(td.error ?? "Transcription failed.");
              return;
            }
            const q = (td.text ?? "").trim();
            if (!q) {
              setSttError("No speech detected.");
              return;
            }
            const chat = await apiFetch("/api/chat", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ message: q })
            });
            const cd = (await chat.json().catch(() => ({}))) as { reply?: string; error?: string };
            if (!chat.ok) {
              setSttError(cd.error ?? "Chat failed.");
              return;
            }
            const reply = cd.reply ?? "";
            setMarkdown(reply);
            const spoken = stripMarkdownForTts(reply);
            if (spoken.trim()) {
              await playTts(spoken);
            }
          } finally {
            setThinking(false);
          }
        })();
      };
      recorder.start();
      setListening(true);
    } catch (e) {
      setSttError(e instanceof Error ? e.message : "Could not access microphone.");
    }
  }, [playTts]);

  const kioskOrbIdle = !listening && !thinking && !ttsPlaying;
  const kioskOrbPreset: VoiceOrbPresetName = ttsPlaying ? "speaking" : listening || thinking ? "thinking" : "calm";

  const toggleMic = useCallback(() => {
    if (listening) {
      stopRecorder();
    } else {
      void startRecorder();
    }
  }, [listening, startRecorder, stopRecorder]);

  return (
    <div className="flex h-[100dvh] flex-col bg-surface pt-14 text-text sm:pt-16">
      <div className="flex h-[33vh] min-h-[140px] shrink-0 flex-col items-center justify-center px-4">
        <div className="h-full w-full max-w-[min(52vw,420px)] overflow-hidden rounded-full">
          <NovaThreeSpeakingOrb
            ref={orbRef}
            className="h-full w-full"
            preset={kioskOrbPreset}
            baseColor="#ff4420"
            transparentBackground
            presentationIdleCalm={kioskOrbIdle}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-6 pb-6 pt-2 [scrollbar-width:thin]">
        {markdown.trim().length === 0 ? (
          <p className="text-center text-xl text-muted">Waiting for Nova…</p>
        ) : (
          <div className="prose prose-invert max-w-none text-xl leading-relaxed md:text-2xl md:leading-relaxed">
            <ChatMarkdown content={markdown} />
          </div>
        )}
        {sttError ? <p className="mt-4 text-center text-sm text-rose-400">{sttError}</p> : null}
        {thinking ? <p className="mt-2 text-center text-sm text-muted">Thinking…</p> : null}
      </div>

      <div className="pointer-events-none fixed left-0 right-0 top-4 z-20 flex h-10 items-center justify-center px-4">
        <button
          type="button"
          onClick={() => toggleMic()}
          title={listening ? "Stop and send" : "Speak to Nova"}
          className={cn(
            "pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full border-2 shadow-lg transition-colors",
            listening
              ? "border-rose-400 bg-rose-500/20 text-rose-100"
              : "border-slate-500/60 bg-surface2/95 text-text hover:bg-surface2"
          )}
        >
          <FaMicrophone className="h-4 w-4" />
        </button>
        <div className="pointer-events-none absolute right-4 top-1/2 h-10 w-28 -translate-y-1/2 sm:right-8">
          <Image
            src="/brand/nova_logo.png"
            alt="Nova"
            fill
            sizes="112px"
            className="object-contain object-right"
            priority
          />
        </div>
      </div>

      <audio ref={audioRef} className="hidden" playsInline />
    </div>
  );
}
