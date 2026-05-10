/**
 * Nova “ReactiveOrb” (from standalone Nova_Orb project), embedded for TTS + kiosk.
 * Canvas2D ring with spectrum-driven displacements; warm/cool gradient around the ring.
 */

export type VoiceOrbPresetName = "calm" | "thinking" | "speaking" | "excited";

export interface RotationDirection {
  x: number;
  y: number;
  z: number;
}

export interface VoiceOrbPreset {
  speechLevel: number;
  rotationSpeed: number;
  direction: RotationDirection;
}

const PRESETS: Record<VoiceOrbPresetName, VoiceOrbPreset> = {
  calm: {
    speechLevel: 0,
    rotationSpeed: 0.085,
    direction: { x: 0.12, y: 1, z: 0.06 }
  },
  thinking: {
    speechLevel: 0.3,
    rotationSpeed: 0.7,
    direction: { x: 0.45, y: 0.9, z: 0.2 }
  },
  speaking: {
    speechLevel: 0.72,
    rotationSpeed: 1.8,
    direction: { x: 0.2, y: 1, z: 0.4 }
  },
  excited: {
    speechLevel: 0.96,
    rotationSpeed: 2.7,
    direction: { x: 0.8, y: 0.4, z: 0.75 }
  }
};

export interface NovaReactiveOrb2DOptions {
  baseColor?: string;
  transparentBackground?: boolean;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const lerp = (from: number, to: number, alpha: number): number => from + (to - from) * alpha;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Feeds the orb either live AnalyserNode frequency bytes (TTS) or synthetic spectrum from
 * `setSpeechEnvelope` when no FFT is available (kiosk presets).
 */
class OrbAudioFeed {
  private frequencies: Uint8Array<ArrayBuffer> = new Uint8Array(0) as Uint8Array<ArrayBuffer>;
  private lastSpectrumMs = 0;
  private low = 0;
  private mid = 0;
  private high = 0;
  energy = 0;

  /** Slightly longer than one frame so TTS FFT gaps don’t flash “mic idle”. */
  private static readonly SPECTRUM_TTL_MS = 120;

  setSpectrum(data: Uint8Array<ArrayBuffer>): void {
    if (this.frequencies.length !== data.length) {
      this.frequencies = new Uint8Array(new ArrayBuffer(data.length)) as Uint8Array<ArrayBuffer>;
    }
    this.frequencies.set(data);
    this.lastSpectrumMs = typeof performance !== "undefined" ? performance.now() : 0;
  }

  setEnvelope(_smooth: number, _peak: number): void {
    void _smooth;
    void _peak;
  }

  randomizePhase(): void {
    /* Standalone orb jitters phase via spectrum; kept for driver API parity. */
  }

  get ready(): boolean {
    if (this.frequencies.length === 0) return false;
    const now = typeof performance !== "undefined" ? performance.now() : 0;
    return now - this.lastSpectrumMs < OrbAudioFeed.SPECTRUM_TTL_MS;
  }

  update(dt: number): void {
    // Match standalone Nova_Orb `AudioInput` whenAnalyser isn’t feeding (no mic / no fresh FFT).
    if (!this.ready || this.frequencies.length === 0) {
      this.energy = lerp(this.energy, 0, 0.08 * dt);
      this.low = lerp(this.low, 0, 0.12 * dt);
      this.mid = lerp(this.mid, 0, 0.12 * dt);
      this.high = lerp(this.high, 0, 0.12 * dt);
      return;
    }

    const lowTarget = this.getBandEnergy(0.0, 0.12);
    const midTarget = this.getBandEnergy(0.12, 0.4);
    const highTarget = this.getBandEnergy(0.4, 0.9);

    const lowAlpha = lowTarget > this.low ? 0.26 * dt : 0.18 * dt;
    const midAlpha = midTarget > this.mid ? 0.22 * dt : 0.16 * dt;
    const highAlpha = highTarget > this.high ? 0.28 * dt : 0.2 * dt;

    this.low = lerp(this.low, lowTarget, lowAlpha);
    this.mid = lerp(this.mid, midTarget, midAlpha);
    this.high = lerp(this.high, highTarget, highAlpha);
    this.energy = clamp((this.low * 1.6 + this.mid * 1.1 + this.high * 0.9) / 3.3, 0, 1);
  }

  getFrequencyAt(normalizedPosition: number): number {
    if (!this.ready || this.frequencies.length === 0) {
      return 0;
    }

    const pos = clamp(normalizedPosition, 0, 1);
    const index = Math.floor(pos * (this.frequencies.length - 1));
    return (this.frequencies[index] ?? 0) / 255;
  }

  private getBandEnergy(start: number, end: number): number {
    const n = this.frequencies.length;
    const startIndex = Math.floor(start * n);
    const endIndex = Math.max(startIndex + 1, Math.floor(end * n));
    let sum = 0;
    for (let i = startIndex; i < endIndex; i += 1) {
      sum += this.frequencies[i] ?? 0;
    }
    return sum / (endIndex - startIndex) / 255;
  }
}

class ReactiveOrbCore {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly audio: OrbAudioFeed;
  private readonly mount: HTMLElement;
  private readonly pointCount = 420;
  private readonly displacements = new Float32Array(this.pointCount);
  private width = 1;
  private height = 1;
  private centerX = 0;
  private centerY = 0;
  private baseRadius = 120;
  private time = 0;
  private presentationIdleCalm = false;

  private rafId = 0;
  private resizeObserver: ResizeObserver | null = null;
  private lastFrameMs = 0;

  constructor(mount: HTMLElement, canvas: HTMLCanvasElement, audio: OrbAudioFeed) {
    this.mount = mount;
    this.canvas = canvas;
    this.audio = audio;

    const maybeContext = this.canvas.getContext("2d", { alpha: true });
    if (!maybeContext) {
      throw new Error("2D canvas context is not available.");
    }
    this.context = maybeContext;

    this.lastFrameMs = performance.now();
    window.addEventListener("resize", this.onResize);
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.onResize());
      this.resizeObserver.observe(mount);
    }
    this.onResize();
    this.rafId = requestAnimationFrame(this.tick);
  }

  setRotationSpeed(_speed: number): void {
    void _speed;
  }

  setPresentationIdleCalm(calm: boolean): void {
    this.presentationIdleCalm = calm;
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener("resize", this.onResize);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }

  private tick = (now: number): void => {
    this.rafId = requestAnimationFrame(this.tick);
    const dt = clamp((now - this.lastFrameMs) / 16.6667, 0.25, 2.2);
    this.lastFrameMs = now;
    // Same progression as `C:\Users\ambru\source\Nova_Orb\src\main.ts` ReactiveOrb.start()
    this.time += now * 0.0000012;

    this.audio.update(dt);
    this.updateDisplacements(dt);
    this.render();
  };

  private updateDisplacements(dt: number): void {
    // Slightly larger than Nova_Orb 0.1 so TTS (speech band) reads as taller spikes on smaller mounts.
    const maxSpike = Math.min(this.width, this.height) * 0.14;
    const calmMul = this.presentationIdleCalm ? 0.35 : 1;
    const live = this.audio.ready;
    const intensity = (live ? 0.24 + this.audio.energy * 4.0 : 0.15) * calmMul;
    const attack = live ? 0.42 : 0.18;
    const decay = live ? 0.28 : 0.16;

    for (let i = 0; i < this.pointCount; i += 1) {
      const t = i / this.pointCount;
      const angle = t * Math.PI * 2;
      const spectral = this.getWrappedSpectrum(t);
      const wave = (Math.sin(this.time * 60 + i * 0.22) * 0.5 + 0.5) * 0.075;

      // Lower exponent = less squash on mid-level bins → visibly higher waves when Nova speaks.
      const target = Math.pow(spectral, 1.48) * maxSpike * intensity + wave * maxSpike;
      const outwardOnly = Math.max(0, target);

      const displacementAlpha = outwardOnly > this.displacements[i] ? attack * dt : decay * dt;
      this.displacements[i] = lerp(this.displacements[i], outwardOnly, displacementAlpha);

      this.displacements[i] += Math.sin(angle * 2 + this.time * 9) * 0.018;
      if (this.displacements[i] < 0) {
        this.displacements[i] = 0;
      }
    }
  }

  private getWrappedSpectrum(t: number): number {
    const wrapped = (t + 0.137 + Math.sin(t * Math.PI * 6 + this.time * 0.3) * 0.035) % 1;
    const jitterA = Math.sin(t * Math.PI * 10 + this.time * 0.41) * 0.045;
    const jitterB = Math.sin(t * Math.PI * 18 - this.time * 0.27) * 0.025;

    const sampleA = this.audio.getFrequencyAt(clamp((wrapped * 0.86) + jitterA, 0, 1));
    const sampleB = this.audio.getFrequencyAt(clamp((((wrapped * 1.618) % 1) * 0.86) + jitterB, 0, 1));
    const sampleC = this.audio.getFrequencyAt(clamp((((wrapped * 2.414) % 1) * 0.86) - jitterA * 0.5, 0, 1));
    const sampleD = this.audio.getFrequencyAt(clamp((((wrapped * 0.73) + 0.19) % 1) * 0.86, 0, 1));

    const averaged = sampleA * 0.34 + sampleB * 0.26 + sampleC * 0.24 + sampleD * 0.16;

    return Math.max(averaged, this.audio.energy * 0.22);
  }

  private render(): void {
    this.context.clearRect(0, 0, this.width, this.height);

    this.drawFilledBand(this.baseRadius - 18, 1.0, 0.58);

    this.drawStaticPass(this.baseRadius - 18, 1.0, 0.55, 22, 3.2);
    this.drawStaticPass(this.baseRadius - 18, 1.02, 1.0, 22, 4.2, true);

    this.drawPass(0.88, 0.22, 36, 2.8);
    this.drawPass(1.0, 0.55, 22, 3.2);
    this.drawPass(1.02, 0.95, 7, 4.2);
  }

  private drawFilledBand(innerRadius: number, outerScale: number, alpha: number): void {
    this.context.shadowBlur = 0;
    this.context.shadowColor = "transparent";
    const innerWaveScale = 0.95;

    for (let i = 0; i < this.pointCount; i += 1) {
      const next = (i + 1) % this.pointCount;

      const a1 = (i / this.pointCount) * Math.PI * 2;
      const a2 = (next / this.pointCount) * Math.PI * 2;

      const innerR1 = innerRadius - this.displacements[i] * innerWaveScale;
      const innerR2 = innerRadius - this.displacements[next] * innerWaveScale;
      const innerX1 = this.centerX + Math.cos(a1) * innerR1;
      const innerY1 = this.centerY + Math.sin(a1) * innerR1;
      const innerX2 = this.centerX + Math.cos(a2) * innerR2;
      const innerY2 = this.centerY + Math.sin(a2) * innerR2;

      const outerR1 = this.baseRadius + this.displacements[i] * outerScale;
      const outerR2 = this.baseRadius + this.displacements[next] * outerScale;
      const outerX1 = this.centerX + Math.cos(a1) * outerR1;
      const outerY1 = this.centerY + Math.sin(a1) * outerR1;
      const outerX2 = this.centerX + Math.cos(a2) * outerR2;
      const outerY2 = this.centerY + Math.sin(a2) * outerR2;

      const color = this.getRingColor(a1, alpha);
      this.context.fillStyle = color.stroke;

      this.context.beginPath();
      this.context.moveTo(innerX1, innerY1);
      this.context.lineTo(outerX1, outerY1);
      this.context.lineTo(outerX2, outerY2);
      this.context.lineTo(innerX2, innerY2);
      this.context.closePath();
      this.context.fill();
    }
  }

  private drawStaticPass(
    radius: number,
    scale: number,
    alpha: number,
    blur: number,
    lineWidth: number,
    forceWhite = false
  ): void {
    this.context.lineCap = "round";
    this.context.lineJoin = "round";
    this.context.lineWidth = lineWidth;
    this.context.shadowBlur = blur;

    const scaledRadius = radius * scale;

    for (let i = 0; i < this.pointCount; i += 1) {
      const next = (i + 1) % this.pointCount;

      const a1 = (i / this.pointCount) * Math.PI * 2;
      const a2 = (next / this.pointCount) * Math.PI * 2;

      const x1 = this.centerX + Math.cos(a1) * scaledRadius;
      const y1 = this.centerY + Math.sin(a1) * scaledRadius;
      const x2 = this.centerX + Math.cos(a2) * scaledRadius;
      const y2 = this.centerY + Math.sin(a2) * scaledRadius;

      if (forceWhite) {
        const whiteLineWidth = lineWidth * 1.5;

        this.context.shadowColor = "rgba(255, 255, 255, 0.9)";
        this.context.shadowBlur = blur * 1.1;

        this.context.lineWidth = whiteLineWidth;
        this.context.strokeStyle = "rgba(255, 255, 255, 0.12)";
        this.context.beginPath();
        this.context.moveTo(x1, y1);
        this.context.lineTo(x2, y2);
        this.context.stroke();

        this.context.lineWidth = whiteLineWidth * 0.58;
        this.context.strokeStyle = "rgba(255, 255, 255, 0.42)";
        this.context.beginPath();
        this.context.moveTo(x1, y1);
        this.context.lineTo(x2, y2);
        this.context.stroke();

        this.context.lineWidth = whiteLineWidth * 0.2;
        this.context.strokeStyle = "rgba(255, 255, 255, 1)";
        this.context.beginPath();
        this.context.moveTo(x1, y1);
        this.context.lineTo(x2, y2);
        this.context.stroke();

        continue;
      } else {
        const color = this.getRingColor(a1, alpha);
        this.context.strokeStyle = color.stroke;
        this.context.shadowColor = color.glow;
      }

      this.context.beginPath();
      this.context.moveTo(x1, y1);
      this.context.lineTo(x2, y2);
      this.context.stroke();
    }
  }

  private drawPass(scale: number, alpha: number, blur: number, lineWidth: number): void {
    this.context.lineCap = "round";
    this.context.lineJoin = "round";
    this.context.lineWidth = lineWidth;
    this.context.shadowBlur = blur;

    for (let i = 0; i < this.pointCount; i += 1) {
      const next = (i + 1) % this.pointCount;

      const a1 = (i / this.pointCount) * Math.PI * 2;
      const a2 = (next / this.pointCount) * Math.PI * 2;

      const r1 = this.baseRadius + this.displacements[i] * scale;
      const r2 = this.baseRadius + this.displacements[next] * scale;

      const x1 = this.centerX + Math.cos(a1) * r1;
      const y1 = this.centerY + Math.sin(a1) * r1;
      const x2 = this.centerX + Math.cos(a2) * r2;
      const y2 = this.centerY + Math.sin(a2) * r2;

      const color = this.getRingColor(a1, alpha);
      this.context.strokeStyle = color.stroke;
      this.context.shadowColor = color.glow;

      this.context.beginPath();
      this.context.moveTo(x1, y1);
      this.context.lineTo(x2, y2);
      this.context.stroke();
    }
  }

  private getRingColor(angle: number, alpha: number): { stroke: string; glow: string } {
    // Locked to Nova_Orb sample (`main.ts` getRingColor) — do not pastel via chat mood.
    const coolColor = { r: 20, g: 122, b: 255 };
    const warmColor = { r: 255, g: 126, b: 0 };

    const baseMix = (Math.sin(angle - Math.PI * 0.35) + 1) * 0.5;
    const warp =
      Math.sin(angle * 3.0 + this.time * 0.55) * 0.08 + Math.sin(angle * 7.0 - this.time * 0.18) * 0.03;
    const mix = clamp(baseMix + warp, 0, 1);
    const easedMix = mix * mix * (3 - 2 * mix);
    const highlight = Math.pow(clamp(Math.abs(mix - 0.5) - 0.44, 0, 1), 3.4);

    let r = lerp(coolColor.r, warmColor.r, easedMix);
    let g = lerp(coolColor.g, warmColor.g, easedMix);
    let b = lerp(coolColor.b, warmColor.b, easedMix);

    r = lerp(r, 255, highlight);
    g = lerp(g, 255, highlight);
    b = lerp(b, 255, highlight);

    const stroke = `rgba(${r.toFixed(0)}, ${g.toFixed(0)}, ${b.toFixed(0)}, ${alpha.toFixed(3)})`;
    const glow = `rgba(250, 250, 255, ${(alpha * 0.18).toFixed(3)})`;

    return { stroke, glow };
  }

  private onResize = (): void => {
    const w = this.mount.clientWidth;
    const h = Math.max(this.mount.clientHeight, 1);
    this.width = w;
    this.height = h;
    this.centerX = this.width * 0.5;
    this.centerY = this.height * 0.5;
    this.baseRadius = Math.min(this.width, this.height) * 0.31;

    const dpr = Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
    this.canvas.width = Math.max(1, Math.floor(this.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(this.height * dpr));
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;

    this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
}

/** Public wrapper matching the previous `AIVoiceRing2D` imperative surface. */
export class NovaReactiveOrb2D {
  private readonly feed: OrbAudioFeed;
  private core: ReactiveOrbCore | null = null;
  private readonly canvas: HTMLCanvasElement;
  private presentationIdleCalm = false;

  constructor(
    private readonly mount: HTMLElement,
    options: NovaReactiveOrb2DOptions = {}
  ) {
    this.feed = new OrbAudioFeed();
    this.canvas = document.createElement("canvas");
    this.canvas.style.display = "block";
    this.canvas.style.position = "absolute";
    this.canvas.style.left = "0";
    this.canvas.style.top = "0";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.zIndex = "0";
    if (options.transparentBackground !== false) {
      this.canvas.style.background = "transparent";
    }
    this.mount.style.position = "relative";
    this.mount.style.background = "transparent";
    this.mount.appendChild(this.canvas);

    this.core = new ReactiveOrbCore(this.mount, this.canvas, this.feed);

    void options.baseColor;
  }

  setBaseColor(_hex: string): void {
    void _hex;
  }

  setSpectrum(data: Uint8Array<ArrayBuffer>): void {
    this.feed.setSpectrum(data);
  }

  setPresentationIdleCalm(calm: boolean): void {
    this.presentationIdleCalm = calm;
    this.core?.setPresentationIdleCalm(calm);
    if (calm) {
      this.feed.setEnvelope(0, 0);
    }
  }

  setSpeechEnvelope(smooth: number, peak: number): void {
    this.feed.setEnvelope(clamp01(smooth), clamp01(peak));
  }

  setSpeechLevel(level: number): void {
    const v = clamp01(level);
    this.setSpeechEnvelope(v, v);
  }

  setMoodPalette(_colorA: string, _colorB: string, _shellRgb: string, _glowHex: string): void {
    void _colorA;
    void _colorB;
    void _shellRgb;
    void _glowHex;
  }

  setRotationSpeed(speed: number): void {
    this.core?.setRotationSpeed(speed);
  }

  setRotationDirection(_direction: RotationDirection): void {
    void _direction;
  }

  randomizeDirection(): void {
    this.feed.randomizePhase();
  }

  applyPreset(name: VoiceOrbPresetName): void {
    const preset = PRESETS[name];
    if (!this.presentationIdleCalm) {
      this.setSpeechLevel(preset.speechLevel);
    }
    this.setRotationSpeed(preset.rotationSpeed);
  }

  applyPresetValues(values: VoiceOrbPreset): void {
    if (!this.presentationIdleCalm) {
      this.setSpeechLevel(values.speechLevel);
    }
    this.setRotationSpeed(values.rotationSpeed);
  }

  dispose(): void {
    this.core?.dispose();
    this.core = null;
    try {
      if (this.canvas.parentNode === this.mount) {
        this.mount.removeChild(this.canvas);
      }
    } catch {
      /* ignore */
    }
  }
}
