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

export interface VoiceRing2DOptions {
  baseColor?: string;
  transparentBackground?: boolean;
  /**
   * Hard inner limit: the wavy stroke never crosses inside this radius (clear center, “red circle”).
   * Fraction of half the shorter canvas side (0–1).
   */
  innerHoleRadiusNorm?: number;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function damp(current: number, target: number, lambda: number, dt: number): number {
  const a = 1 - Math.exp(-lambda * dt);
  return current + (target - current) * a;
}

function parseHex(hex: string): { r: number; g: number; b: number } {
  const h = hex.trim().replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  if (!Number.isFinite(n)) return { r: 255, g: 61, b: 38 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbStr(r: number, g: number, b: number, a = 1): string {
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpRgb(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
  t: number
): { r: number; g: number; b: number } {
  return { r: lerp(a.r, b.r, t), g: lerp(a.g, b.g, t), b: lerp(a.b, b.b, t) };
}

/**
 * Thin “sun corona”: one wavy circle (fixed mean radius), stroked only — no filled donut, no purple plate.
 * Colors sweep around the ring via conic gradient; glow from layered strokes + light shadows only.
 */
export class AIVoiceRing2D {
  private readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private rafId = 0;
  private innerHoleNorm: number;

  private speechLevel = 0;
  private speechPeak = 0;
  private dampedSpeak = 0;
  private dampedSpeakPeak = 0;
  private presentationIdleCalm = false;

  private rotationSpeed = 0.5;
  private gradientAngle = 0;
  private noiseSeed = 0;
  private timeSec = 0;
  private lastFrameMs = 0;

  private moodA = { ...parseHex("#ff2e12") };
  private moodB = { ...parseHex("#00dcff") };
  private moodTargetA = { ...this.moodA };
  private moodTargetB = { ...this.moodB };

  constructor(
    private readonly mount: HTMLElement,
    options: VoiceRing2DOptions = {}
  ) {
    this.innerHoleNorm = options.innerHoleRadiusNorm ?? 0.38;
    this.canvas = document.createElement("canvas");
    this.canvas.style.display = "block";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    const transparent = options.transparentBackground !== false;
    if (transparent) {
      this.canvas.style.background = "transparent";
    }
    const c = this.canvas.getContext("2d", { alpha: true });
    if (!c) {
      throw new Error("2D canvas unsupported");
    }
    this.ctx = c;
    this.mount.style.position = "relative";
    this.mount.style.background = "transparent";
    this.mount.appendChild(this.canvas);

    if (options.baseColor) {
      this.setBaseColor(options.baseColor);
    }

    window.addEventListener("resize", this.handleResize);
    this.handleResize();
    this.lastFrameMs = performance.now();
    this.animate();
  }

  setBaseColor(hex: string): void {
    const accent = parseHex(hex);
    const warmAnchor = parseHex("#ff2e12");
    const coolAnchor = parseHex("#00dcff");
    const warm = lerpRgb(warmAnchor, accent, 0.12);
    const cool = lerpRgb(coolAnchor, accent, 0.08);
    this.moodTargetA = warm;
    this.moodTargetB = cool;
    this.moodA = { ...warm };
    this.moodB = { ...cool };
  }

  setPresentationIdleCalm(calm: boolean): void {
    this.presentationIdleCalm = calm;
    if (calm) {
      this.speechLevel = 0;
      this.speechPeak = 0;
      this.dampedSpeak = 0;
      this.dampedSpeakPeak = 0;
    }
  }

  setSpeechEnvelope(smooth: number, peak: number): void {
    this.speechLevel = clamp01(smooth);
    this.speechPeak = clamp01(peak);
  }

  setSpeechLevel(level: number): void {
    const v = clamp01(level);
    this.setSpeechEnvelope(v, v);
  }

  setMoodPalette(colorA: string, colorB: string, _shellRgb: string, _glowHex: string): void {
    void colorA;
    void colorB;
    void _shellRgb;
    void _glowHex;
    // Keep this art direction locked to the vivid reference. Emotion palettes tend to pastel this ring.
    this.moodTargetA = parseHex("#ff2e12");
    this.moodTargetB = parseHex("#00dcff");
  }

  setRotationSpeed(speed: number): void {
    this.rotationSpeed = Math.max(0, speed);
  }

  setRotationDirection(_direction: RotationDirection): void {
    void _direction;
  }

  randomizeDirection(): void {
    this.noiseSeed += Math.PI * (1.8 + Math.random() * 4);
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
    cancelAnimationFrame(this.rafId);
    window.removeEventListener("resize", this.handleResize);
    try {
      if (this.canvas.parentNode === this.mount) {
        this.mount.removeChild(this.canvas);
      }
    } catch {
      /* ignore */
    }
  }

  private handleResize = (): void => {
    const w = this.mount.clientWidth;
    const h = Math.max(this.mount.clientHeight, 1);
    const pr = Math.min(window.devicePixelRatio, 2);
    this.canvas.width = Math.max(1, Math.floor(w * pr));
    this.canvas.height = Math.max(1, Math.floor(h * pr));
    this.ctx.setTransform(pr, 0, 0, pr, 0, 0);
  };

  private energy(): number {
    if (this.presentationIdleCalm) {
      return 0;
    }
    return clamp01(this.dampedSpeak * 0.85 + this.dampedSpeakPeak * 0.7);
  }

  /** Radial corona modulation around a fixed base circle (−1…1), smooth “plasma” silhouette. */
  private sampleRadialWave(theta: number): number {
    const t = this.timeSec;
    const k = this.noiseSeed;
    const s0 = Math.sin(theta * 4 + t * 0.95 + k);
    const s1 = Math.sin(theta * 9 - t * 0.62 + k * 1.2);
    const s2 = Math.sin(theta * 14 + t * 1.05 + k * 0.35);
    return s0 * 0.5 + s1 * 0.34 + s2 * 0.16;
  }

  /**
   * Localized conic gradient: orange concentrated at the top, blue at the bottom, white on the sides.
   * No rotation so the colors stay anchored like the reference poster.
   */
  private createConic(cx: number, cy: number): CanvasGradient {
    const g = this.ctx.createConicGradient(-Math.PI / 2, cx, cy);
    const A = this.moodA;
    const B = this.moodB;
    g.addColorStop(0.0, rgbStr(A.r, A.g, A.b, 1));
    g.addColorStop(0.06, rgbStr(255, 170, 130, 1));
    g.addColorStop(0.18, rgbStr(255, 255, 255, 1));
    g.addColorStop(0.36, rgbStr(255, 255, 255, 1));
    g.addColorStop(0.46, rgbStr(160, 220, 255, 1));
    g.addColorStop(0.5, rgbStr(B.r, B.g, B.b, 1));
    g.addColorStop(0.54, rgbStr(160, 220, 255, 1));
    g.addColorStop(0.66, rgbStr(255, 255, 255, 1));
    g.addColorStop(0.84, rgbStr(255, 255, 255, 1));
    g.addColorStop(0.94, rgbStr(255, 170, 130, 1));
    g.addColorStop(1.0, rgbStr(A.r, A.g, A.b, 1));
    return g;
  }

  private buildWavyPath(pts: { x: number; y: number }[]): void {
    const p0 = pts[0]!;
    this.ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i]!;
      this.ctx.lineTo(p.x, p.y);
    }
    this.ctx.closePath();
  }

  private animate = (): void => {
    this.rafId = requestAnimationFrame(this.animate);
    const now = performance.now();
    const dt = Math.min((now - this.lastFrameMs) / 1000, 0.05);
    this.lastFrameMs = now;

    const dampRate = this.presentationIdleCalm ? 22 : 42;
    const dampPeakRate = this.presentationIdleCalm ? 36 : 86;
    this.dampedSpeak = damp(this.dampedSpeak, this.speechLevel, dampRate, dt);
    this.dampedSpeakPeak = damp(this.dampedSpeakPeak, this.speechPeak, dampPeakRate, dt);

    this.timeSec += dt * (this.presentationIdleCalm ? 1 : 2.35);
    // Gradient stays anchored: orange up, blue down. No rotation.

    this.moodA.r += (this.moodTargetA.r - this.moodA.r) * Math.min(1, dt * 4.2);
    this.moodA.g += (this.moodTargetA.g - this.moodA.g) * Math.min(1, dt * 4.2);
    this.moodA.b += (this.moodTargetA.b - this.moodA.b) * Math.min(1, dt * 4.2);
    this.moodB.r += (this.moodTargetB.r - this.moodB.r) * Math.min(1, dt * 4.2);
    this.moodB.g += (this.moodTargetB.g - this.moodB.g) * Math.min(1, dt * 4.2);
    this.moodB.b += (this.moodTargetB.b - this.moodB.b) * Math.min(1, dt * 4.2);

    const w = this.mount.clientWidth;
    const h = Math.max(this.mount.clientHeight, 1);
    const cx = w * 0.5;
    const cy = h * 0.5;
    const half = Math.min(w, h) * 0.5;
    const rHole = half * this.innerHoleNorm;
    const rMargin = half * 0.01;
    // Leave outer headroom inside the canvas so glow never gets clipped to a hard square.
    const rBase = half * 0.52;

    const e = this.energy();
    const idleBreath = this.presentationIdleCalm ? 0.14 + Math.sin(this.timeSec * 0.82) * 0.1 : 0;
    const waveBoost = this.presentationIdleCalm ? idleBreath : e;

    const maxInward = Math.max(0, rBase - rHole - rMargin);
    const ampDesired = half * (0.022 + waveBoost * 0.34);
    const amp = Math.min(ampDesired, maxInward * 0.95);

    const steps = 400;
    const wavePts: { x: number; y: number }[] = [];
    for (let i = 0; i <= steps; i++) {
      const theta = (i / steps) * Math.PI * 2;
      const wv = this.sampleRadialWave(theta);
      const r = Math.max(rHole + rMargin, rBase + wv * amp);
      wavePts.push({ x: cx + Math.cos(theta) * r, y: cy + Math.sin(theta) * r });
    }

    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    const conic = this.createConic(cx, cy);

    // Real neon: additive blending so overlapping strokes pile up to white instead of muddy grey.
    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    // Wide colored aura. Modest shadow so the soft halo stays inside the canvas.
    ctx.strokeStyle = conic;
    ctx.lineWidth = 26;
    ctx.shadowBlur = 18;
    ctx.shadowColor = "rgba(150, 210, 255, 0.95)";
    ctx.beginPath();
    this.buildWavyPath(wavePts);
    ctx.stroke();

    // Mid colored neon body. Conic keeps orange at the top and blue at the bottom.
    ctx.strokeStyle = conic;
    ctx.lineWidth = 14;
    ctx.shadowBlur = 12;
    ctx.shadowColor = "rgba(255, 255, 255, 0.95)";
    ctx.beginPath();
    this.buildWavyPath(wavePts);
    ctx.stroke();

    // Bright white inner glow.
    ctx.strokeStyle = "rgba(255,255,255,1)";
    ctx.lineWidth = 6;
    ctx.shadowBlur = 6;
    ctx.shadowColor = "rgba(255,255,255,1)";
    ctx.beginPath();
    this.buildWavyPath(wavePts);
    ctx.stroke();

    // Sharp white core, no blur. Reads as the actual neon tube.
    ctx.strokeStyle = "rgba(255,255,255,1)";
    ctx.lineWidth = 2.4;
    ctx.shadowBlur = 0;
    ctx.beginPath();
    this.buildWavyPath(wavePts);
    ctx.stroke();

    ctx.restore();
  };
}
