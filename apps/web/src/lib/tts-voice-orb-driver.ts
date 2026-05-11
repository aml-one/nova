import {
  NOVA_ORB_MOOD_DEFAULT_A,
  NOVA_ORB_MOOD_DEFAULT_B,
  NOVA_ORB_MOOD_DEFAULT_GLOW,
  NOVA_ORB_MOOD_DEFAULT_SHELL,
  lerpHexColor,
  orbMoodPaletteForEmotionLabel
} from "./nova-orb-mood";

export type TtsVoiceOrbDriverTarget = {
  setSpeechEnvelope: (smooth: number, peak: number) => void;
  setSpectrum?: (freqBytes: Uint8Array<ArrayBuffer>) => void;
  randomizeDirection: () => void;
  setRotationSpeed: (speed: number) => void;
  setMoodPalette: (colorA: string, colorB: string, shellRgb: string, glowHex: string) => void;
};

export type TtsVoiceOrbDriverConfig = {
  getOrb: () => TtsVoiceOrbDriverTarget | null;
  /** Chat: wrapper for CSS scale pulse. Kiosk: return null to skip. */
  getMeter: () => HTMLElement | null;
  getEmotionLabel: () => string;
  requireMeterForAttach: boolean;
  enableMoodFromEmotion: boolean;
  enablePeriodicDirectionFlip: boolean;
};

const MAX_ATTACH_RETRIES = 55;
const ATTACH_RETRY_MS = 24;

/**
 * Drives the WebGL voice orb from the actual TTS audio element via Web Audio (AnalyserNode):
 * time-domain RMS + speech-frequency band energy → `setSpeechEnvelope`, optional meter scale + mood gloss.
 */
export class TtsVoiceOrbDriver {
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private mediaSourceNode: MediaElementAudioSourceNode | null = null;
  private boundMediaElement: HTMLAudioElement | null = null;

  private rafId: number | null = null;
  /** Browser timers are numeric handles (DOM lib); avoid NodeJS.Timeout from `setTimeout` typing. */
  private attachRetryId: number | null = null;
  private directionTimerId: number | null = null;
  private directionActive = false;
  private attachAttempt = 0;

  private voiceLevel = 0;
  private prevInstant = 0;
  private wordSpike = 0;
  private lastFlipAt = 0;
  private slowEnergy = 0;
  private freqBuf: Uint8Array<ArrayBuffer> | null = null;
  private timeDomainBuf = new Float32Array(0);

  private activeAudioEl: HTMLAudioElement | null = null;

  constructor(private readonly config: TtsVoiceOrbDriverConfig) {}

  /** Stop RAF / timers and reset orb visuals; keep Web Audio graph for the same session. */
  stopDriving(): void {
    this.directionActive = false;
    if (this.directionTimerId != null) {
      clearTimeout(this.directionTimerId);
      this.directionTimerId = null;
    }
    if (this.attachRetryId != null) {
      clearTimeout(this.attachRetryId);
      this.attachRetryId = null;
    }
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.attachAttempt = 0;
    this.activeAudioEl = null;

    this.voiceLevel = 0;
    this.prevInstant = 0;
    this.wordSpike = 0;
    this.lastFlipAt = 0;
    this.slowEnergy = 0;

    this.config.getOrb()?.setSpeechEnvelope(0, 0);
    if (this.config.enableMoodFromEmotion) {
      try {
        this.config.getOrb()?.setMoodPalette(
          NOVA_ORB_MOOD_DEFAULT_A,
          NOVA_ORB_MOOD_DEFAULT_B,
          NOVA_ORB_MOOD_DEFAULT_SHELL,
          NOVA_ORB_MOOD_DEFAULT_GLOW
        );
      } catch {
        // Orb can be mid-dispose.
      }
    }
    this.config.getMeter()?.style.removeProperty("transform");
  }

  /** Full teardown (e.g. route unmount): release MediaElementAudioSource and AudioContext. */
  teardownAudioGraph(): void {
    this.stopDriving();
    try {
      this.analyser?.disconnect();
    } catch {
      /* ignore */
    }
    this.analyser = null;
    try {
      this.mediaSourceNode?.disconnect();
    } catch {
      /* ignore */
    }
    this.mediaSourceNode = null;
    this.boundMediaElement = null;
    void this.audioCtx?.close().catch(() => {
      /* ignore */
    });
    this.audioCtx = null;
  }

  attach(el: HTMLAudioElement): void {
    this.stopDriving();
    this.activeAudioEl = el;

    if (this.config.requireMeterForAttach) {
      const meter = this.config.getMeter();
      if (!meter) {
        if (el.paused || el.ended) {
          return;
        }
        if (this.attachAttempt >= MAX_ATTACH_RETRIES) {
          return;
        }
        this.attachAttempt += 1;
        this.attachRetryId = window.setTimeout(() => {
          this.attachRetryId = null;
          this.attach(el);
        }, ATTACH_RETRY_MS);
        return;
      }
    }
    this.attachAttempt = 0;

    this.prevInstant = 0;
    this.wordSpike = 0;
    this.voiceLevel = 0;
    this.slowEnergy = 0;

    const win = typeof window !== "undefined" ? window : undefined;
    const AudioCtx = win?.AudioContext ?? (win as unknown as { webkitAudioContext?: typeof AudioContext } | undefined)?.webkitAudioContext;
    if (!AudioCtx) {
      return;
    }

    if (!this.audioCtx) {
      this.audioCtx = new AudioCtx();
    }
    void this.audioCtx.resume().catch(() => {
      /* gesture-gated */
    });

    if (!this.analyser) {
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.07;
      // Map quieter TTS bins higher in 0–255 so soft/calm voices still move the ring.
      this.analyser.minDecibels = -96;
      this.analyser.maxDecibels = -52;
    } else {
      this.analyser.smoothingTimeConstant = 0.07;
      this.analyser.minDecibels = -96;
      this.analyser.maxDecibels = -52;
    }

    const needNewSource = this.boundMediaElement !== el || !this.mediaSourceNode;
    if (needNewSource) {
      try {
        this.mediaSourceNode?.disconnect();
      } catch {
        /* ignore */
      }
      this.mediaSourceNode = null;
      this.boundMediaElement = el;
      try {
        const src = this.audioCtx.createMediaElementSource(el);
        this.mediaSourceNode = src;
        src.connect(this.analyser);
        this.analyser.connect(this.audioCtx.destination);
      } catch {
        return;
      }
    }

    const tick = (): void => {
      try {
        const analyser = this.analyser;
        const ctxLive = this.audioCtx;
        if (!analyser || !ctxLive) {
          return;
        }
        if (el.paused || el.ended) {
          return;
        }

        const n = analyser.fftSize;
        let buf = this.timeDomainBuf;
        if (buf.length !== n) {
          buf = new Float32Array(n);
          this.timeDomainBuf = buf;
        }
        analyser.getFloatTimeDomainData(buf);
        let sumSq = 0;
        let peak = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = buf[i] ?? 0;
          const a = Math.abs(v);
          if (a > peak) peak = a;
          sumSq += v * v;
        }
        const rms = Math.sqrt(sumSq / Math.max(1, buf.length));
        // Extra lift for quiet waveforms (calm TTS): sqrt compresses loud peaks less than linear on whispers.
        const rmsLift = Math.sqrt(Math.max(0, rms)) * 0.42 + rms * 28;
        const timeInstant = Math.min(1, rmsLift + peak * 6.2);

        const sr = ctxLive.sampleRate ?? 48000;
        const nyquist = sr * 0.5;
        const binCount = analyser.frequencyBinCount;
        let freqBuf = this.freqBuf;
        if (!freqBuf || freqBuf.length !== binCount) {
          freqBuf = new Uint8Array(new ArrayBuffer(binCount)) as Uint8Array<ArrayBuffer>;
          this.freqBuf = freqBuf;
        }
        analyser.getByteFrequencyData(freqBuf);
        try {
          this.config.getOrb()?.setSpectrum?.(freqBuf);
        } catch {
          /* orb mid-dispose */
        }
        const binW = nyquist / Math.max(1, binCount);
        const lo = Math.max(0, Math.floor(180 / binW));
        const hi = Math.min(binCount - 1, Math.ceil(4200 / binW));
        let bandSum = 0;
        for (let i = lo; i <= hi; i++) {
          bandSum += freqBuf[i] ?? 0;
        }
        const bandAvg = bandSum / Math.max(1, hi - lo + 1) / 255;
        const combined = Math.min(1, timeInstant * 0.78 + bandAvg * 2.85 + bandAvg * bandAvg * 0.45);
        const gated = Math.max(0, combined - 0.0025);

        let level = this.voiceLevel;
        const attack = 0.96;
        const release = 0.31;
        if (gated > level) {
          level += (gated - level) * attack;
        } else {
          level += (gated - level) * release;
        }
        this.voiceLevel = level;

        const prevInstant = this.prevInstant;
        const rise = combined - prevInstant;
        this.prevInstant = combined;

        const nowMs = performance.now();
        const onset = combined > 0.028 && rise > 0.01;
        if (onset) {
          const burst = Math.min(1, combined * 1.55 + rise * 3.2 + 0.18);
          this.wordSpike = Math.max(this.wordSpike, burst);
          if (nowMs - this.lastFlipAt > 72) {
            this.lastFlipAt = nowMs;
            const orb = this.config.getOrb();
            orb?.randomizeDirection();
            orb?.setRotationSpeed(0.52 + Math.random() * 2.85);
          }
        }
        this.wordSpike *= 0.79;

        const peakDrive = Math.min(1, combined * 1.38 + this.wordSpike * 1.52);
        this.config.getOrb()?.setSpeechEnvelope(level, peakDrive);

        let slow = this.slowEnergy;
        slow = Math.max(combined, slow * (combined < 0.01 ? 0.9 : 0.994));
        this.slowEnergy = slow;

        // The 2D ring has a fixed frame. Voice energy changes wave height, not container size.
        this.config.getMeter()?.style.removeProperty("transform");

        if (this.config.enableMoodFromEmotion) {
          const basePal = orbMoodPaletteForEmotionLabel(this.config.getEmotionLabel());
          const gloss = Math.min(0.07, combined * 0.055);
          const colorA = lerpHexColor(basePal.a, "#fff0eb", gloss);
          const colorB = lerpHexColor(basePal.b, "#e8f6ff", gloss * 0.82);
          const shell = lerpHexColor(basePal.shell, "#f0f0ff", gloss * 0.35);
          const glow = lerpHexColor(basePal.glow, "#f5e8ff", gloss * 0.45);
          try {
            this.config.getOrb()?.setMoodPalette(colorA, colorB, shell, glow);
          } catch {
            /* orb mid-dispose */
          }
        }

        this.rafId = requestAnimationFrame(tick);
      } catch {
        if (!el.paused && !el.ended) {
          this.rafId = requestAnimationFrame(tick);
        }
      }
    };

    this.rafId = requestAnimationFrame(tick);

    if (this.config.enablePeriodicDirectionFlip) {
      this.directionActive = true;
      const scheduleOrbDirFlip = (): void => {
        if (!this.directionActive) return;
        if (this.directionTimerId != null) {
          clearTimeout(this.directionTimerId);
        }
        this.directionTimerId = window.setTimeout(() => {
          this.directionTimerId = null;
          if (!this.directionActive) return;
          const orb = this.config.getOrb();
          orb?.randomizeDirection();
          orb?.setRotationSpeed(0.45 + Math.random() * 1.6);
          scheduleOrbDirFlip();
        }, 10_000 + Math.random() * 8000);
      };
      scheduleOrbDirFlip();
    }
  }
}
