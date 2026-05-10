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
    const warm = lerpRgb(warmAnchor, accent, 0.22);
    const cool = lerpRgb(coolAnchor, accent, 0.18);
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
    void _shellRgb;
    void _glowHex;
    this.moodTargetA = parseHex(colorA);
    this.moodTargetB = parseHex(colorB);
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

  /** Single radial undulation on the base circle (−1…1), smooth “plasma” silhouette. */
  private sampleRadialWave(theta: number): number {
    const t = this.timeSec;
    const k = this.noiseSeed;
    const s0 = Math.sin(theta * 3 + t * 0.95 + k);
    const s1 = Math.sin(theta * 6 - t * 0.58 + k * 1.2);
    const s2 = Math.sin(theta * 9 + t * 1.05 + k * 0.35);
    return s0 * 0.52 + s1 * 0.32 + s2 * 0.16;
  }

  /** Conic sweep: cyan → white → orange around the ring (reference poster). */
  private createConic(cx: number, cy: number): CanvasGradient {
    const g = this.ctx.createConicGradient(-Math.PI / 2 + this.gradientAngle, cx, cy);
    const B = this.moodB;
    const A = this.moodA;
    g.addColorStop(0, rgbStr(B.r, B.g, B.b, 1));
    g.addColorStop(0.14, rgbStr(lerp(B.r, 255, 0.45), lerp(B.g, 255, 0.45), lerp(B.b, 255, 0.38), 1));
    g.addColorStop(0.28, rgbStr(lerp(B.r, 255, 0.78), lerp(B.g, 255, 0.78), lerp(B.b, 255, 0.72), 1));
    g.addColorStop(0.42, rgbStr(255, 255, 255, 1));
    g.addColorStop(0.52, rgbStr(255, 252, 248, 1));
    g.addColorStop(0.64, rgbStr(lerp(255, A.r, 0.22), lerp(255, A.g, 0.18), lerp(255, A.b, 0.12), 1));
    g.addColorStop(0.8, rgbStr(A.r, A.g, A.b, 1));
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
    const rMargin = half * 0.006;
    // Mean orbit (“base circle”) sits outside the hard hole; waves ride on this radius only.
    const rBase = half * Math.min(0.66, this.innerHoleNorm + 0.2);

    const e = this.energy();
    const idleBreath = this.presentationIdleCalm ? 0.14 + Math.sin(this.timeSec * 0.82) * 0.1 : 0;
    const waveBoost = this.presentationIdleCalm ? idleBreath : e;

    const maxInward = Math.max(0, rBase - rHole - rMargin);
    const ampDesired = half * (0.012 + waveBoost * 0.038);
    const amp = Math.min(ampDesired, maxInward * 0.92);

    const steps = 400;
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i <= steps; i++) {
      const theta = (i / steps) * Math.PI * 2;
      const wv = this.sampleRadialWave(theta);
      let r = rBase + wv * amp;
      r = Math.max(rHole + rMargin, r);
      pts.push({ x: cx + Math.cos(theta) * r, y: cy + Math.sin(theta) * r });
    }

    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    const conic = this.createConic(cx, cy);

    // Faint perfect base circle (mean radius) — “sun” reference orbit, not a filled disk.
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.055)";
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.arc(cx, cy, rBase, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Outer corona: wide, soft, light-tinted shadow only (no dark purple fill).
    ctx.save();
    ctx.strokeStyle = conic;
    ctx.globalAlpha = 0.42;
    ctx.lineWidth = 5.2;
    ctx.shadowBlur = 32 + waveBoost * 26;
    ctx.shadowColor = "rgba(200, 235, 255, 0.55)";
    ctx.beginPath();
    this.buildWavyPath(pts);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = conic;
    ctx.globalAlpha = 0.72;
    ctx.lineWidth = 2.6;
    ctx.shadowBlur = 14 + waveBoost * 16;
    ctx.shadowColor = "rgba(255, 250, 255, 0.5)";
    ctx.beginPath();
    this.buildWavyPath(pts);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = conic;
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.15;
    ctx.shadowBlur = 5 + waveBoost * 8;
    ctx.shadowColor = "rgba(255,255,255,0.65)";
    ctx.beginPath();
    this.buildWavyPath(pts);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = rgbStr(255, 255, 255, 0.55 + waveBoost * 0.28);
    ctx.lineWidth = 0.65;
    ctx.shadowBlur = 0;
    ctx.beginPath();
    this.buildWavyPath(pts);
    ctx.stroke();
    ctx.restore();
  };
}
