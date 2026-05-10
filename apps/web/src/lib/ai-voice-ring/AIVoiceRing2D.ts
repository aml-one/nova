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
    return clamp01(this.dampedSpeak * 0.55 + this.dampedSpeakPeak * 0.42);
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

  /** Conic sweep: cyan → white → orange around the ring (reference poster). */
  private createConic(cx: number, cy: number): CanvasGradient {
    const g = this.ctx.createConicGradient(-Math.PI / 2 + this.gradientAngle, cx, cy);
    const B = this.moodB;
    const A = this.moodA;
    g.addColorStop(0, rgbStr(B.r, B.g, B.b, 1));
    g.addColorStop(0.16, rgbStr(0, 120, 255, 1));
    g.addColorStop(0.28, rgbStr(0, 235, 255, 1));
    g.addColorStop(0.4, rgbStr(255, 255, 255, 1));
    g.addColorStop(0.56, rgbStr(255, 255, 245, 1));
    g.addColorStop(0.7, rgbStr(255, 72, 24, 1));
    g.addColorStop(0.84, rgbStr(A.r, A.g, A.b, 1));
    g.addColorStop(1, rgbStr(B.r, B.g, B.b, 1));
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

    const dampRate = this.presentationIdleCalm ? 22 : 10;
    const dampPeakRate = this.presentationIdleCalm ? 36 : 28;
    this.dampedSpeak = damp(this.dampedSpeak, this.speechLevel, dampRate, dt);
    this.dampedSpeakPeak = damp(this.dampedSpeakPeak, this.speechPeak, dampPeakRate, dt);

    this.timeSec += dt;
    this.gradientAngle += this.rotationSpeed * dt * 0.35;

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
    const rMargin = half * 0.008;
    // The sample reads as a large, fixed circle. Waves ride on this radius; they do not define the circle.
    const rBase = half * 0.79;

    const e = this.energy();
    const idleBreath = this.presentationIdleCalm ? 0.14 + Math.sin(this.timeSec * 0.82) * 0.1 : 0;
    const waveBoost = this.presentationIdleCalm ? idleBreath : e;

    const maxInward = Math.max(0, rBase - rHole - rMargin);
    const ampDesired = half * (0.01 + waveBoost * 0.075);
    const amp = Math.min(ampDesired, maxInward * 0.55);

    const steps = 400;
    const coronaPts: { x: number; y: number }[] = [];
    const innerPts: { x: number; y: number }[] = [];
    for (let i = 0; i <= steps; i++) {
      const theta = (i / steps) * Math.PI * 2;
      const wv = this.sampleRadialWave(theta);
      const outward = Math.max(0, wv);
      const inward = Math.max(0, -wv);
      const ro = rBase + outward * amp;
      const ri = Math.max(rHole + rMargin, rBase - inward * amp * 0.42);
      coronaPts.push({ x: cx + Math.cos(theta) * ro, y: cy + Math.sin(theta) * ro });
      innerPts.push({ x: cx + Math.cos(theta) * ri, y: cy + Math.sin(theta) * ri });
    }

    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    const conic = this.createConic(cx, cy);

    // Perfect base circle: this is the stable "sun" orbit. The waves sit on top of it.
    ctx.save();
    ctx.strokeStyle = conic;
    ctx.globalAlpha = 0.34;
    ctx.lineWidth = 14.4;
    ctx.shadowBlur = 46 + waveBoost * 28;
    ctx.shadowColor = "rgba(35, 190, 255, 0.72)";
    ctx.beginPath();
    ctx.arc(cx, cy, rBase, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = conic;
    ctx.globalAlpha = 0.95;
    ctx.lineWidth = 4.4;
    ctx.shadowBlur = 18 + waveBoost * 13;
    ctx.shadowColor = "rgba(255,255,255,0.92)";
    ctx.beginPath();
    ctx.arc(cx, cy, rBase, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.82)";
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, rBase, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Thin outer corona waves. They are glow strokes, not a second thick body.
    ctx.save();
    ctx.strokeStyle = conic;
    ctx.globalAlpha = 0.48 + waveBoost * 0.22;
    ctx.lineWidth = 5.6;
    ctx.shadowBlur = 36 + waveBoost * 24;
    ctx.shadowColor = "rgba(0, 220, 255, 0.72)";
    ctx.beginPath();
    this.buildWavyPath(coronaPts);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = conic;
    ctx.globalAlpha = 0.88;
    ctx.lineWidth = 2.1;
    ctx.shadowBlur = 12 + waveBoost * 12;
    ctx.shadowColor = "rgba(255,255,255,0.9)";
    ctx.beginPath();
    this.buildWavyPath(coronaPts);
    ctx.stroke();
    ctx.restore();

    // A very subtle inner shimmer so the wave feels attached to the circle without becoming thick.
    ctx.save();
    ctx.strokeStyle = conic;
    ctx.globalAlpha = 0.22 + waveBoost * 0.18;
    ctx.lineWidth = 1.6;
    ctx.shadowBlur = 6;
    ctx.shadowColor = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    this.buildWavyPath(innerPts);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = rgbStr(255, 255, 255, 0.55 + waveBoost * 0.28);
    ctx.lineWidth = 1.1;
    ctx.shadowBlur = 0;
    ctx.beginPath();
    this.buildWavyPath(coronaPts);
    ctx.stroke();
    ctx.restore();
  };
}
