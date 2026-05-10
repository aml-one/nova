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

  /**
   * Organic-sphere body gradient: vivid red-orange dominating the top half,
   * deep cobalt blue dominating the bottom half. Mid-band is purposely darker
   * so the body reads as a 3D sphere with depth (warm light from above,
   * cool shadow below).
   */
  private createBodyGradient(cy: number, rOuter: number): CanvasGradient {
    const A = this.moodA; // warm
    const B = this.moodB; // cool
    const top = cy - rOuter * 1.05;
    const bot = cy + rOuter * 1.05;
    const g = this.ctx.createLinearGradient(0, top, 0, bot);
    g.addColorStop(0.0, rgbStr(255, 110, 60, 0.95));
    g.addColorStop(0.18, rgbStr(A.r, A.g, A.b, 0.92));
    g.addColorStop(0.38, rgbStr(150, 30, 70, 0.7));
    g.addColorStop(0.52, rgbStr(40, 25, 80, 0.55));
    g.addColorStop(0.68, rgbStr(40, 80, 200, 0.78));
    g.addColorStop(0.86, rgbStr(B.r, B.g, B.b, 0.92));
    g.addColorStop(1.0, rgbStr(60, 150, 255, 0.95));
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

    const e = this.energy();
    // Idle = perfectly fixed circle. Waves only appear when audio energy comes in.
    const idleBreath = this.presentationIdleCalm
      ? 0.04 + Math.sin(this.timeSec * 0.7) * 0.025
      : 0;
    const waveBoost = this.presentationIdleCalm ? idleBreath : e;

    // Geometry: large fixed sphere silhouette. Glow + offset + max wave amp must fit
    // inside `half` so the bloom never gets squared off by the canvas edge.
    // Budget on a 377px mount (half≈188): rBase 98 + amp 16 + halo blur 50 + offset 10 ≈ 174 ✓
    const rBase = half * 0.52;
    const ampMax = half * 0.085;
    const amp = ampMax * waveBoost; // 0 when silent ⇒ true fixed circle

    const steps = 280;
    const pts: { x: number; y: number }[] = new Array(steps + 1);
    for (let i = 0; i <= steps; i++) {
      const theta = (i / steps) * Math.PI * 2;
      const wv = this.sampleRadialWave(theta);
      const r = rBase + wv * amp;
      pts[i] = { x: cx + Math.cos(theta) * r, y: cy + Math.sin(theta) * r };
    }

    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // 1. Outer halo: warm bloom on top, cool bloom on bottom (additive).
    //    Shadow blur and offset are kept small enough that the bloom never reaches
    //    the canvas edge (would otherwise show as a square clip).
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(0,0,0,0)"; // transparent — only the shadow blooms
    ctx.shadowBlur = 30 + waveBoost * 20;
    ctx.shadowColor = "rgba(255, 90, 35, 0.6)";
    ctx.shadowOffsetY = -rBase * 0.1;
    ctx.beginPath();
    this.buildWavyPath(pts);
    ctx.stroke();
    ctx.shadowColor = "rgba(40, 110, 255, 0.6)";
    ctx.shadowOffsetY = rBase * 0.1;
    ctx.beginPath();
    this.buildWavyPath(pts);
    ctx.stroke();
    ctx.restore();

    // 2. Body fill: vertical red-top → blue-bottom gradient, with the wavy silhouette.
    const body = this.createBodyGradient(cy, rBase);
    ctx.save();
    ctx.fillStyle = body;
    ctx.beginPath();
    this.buildWavyPath(pts);
    ctx.fill();
    ctx.restore();

    // 3. Surface ridges: 5 concentric wavy strokes scaled inward, each with a slight
    //    angular phase so they don't perfectly overlap. Gives the 3D "folded sphere" look.
    const ridges = 5;
    for (let layer = 1; layer <= ridges; layer++) {
      const scale = 1 - layer * 0.13;
      const phase = layer * 0.11;
      const ridgeAlpha = 0.12 + waveBoost * 0.07;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = `rgba(255,255,255,${ridgeAlpha})`;
      ctx.lineWidth = 1.4;
      ctx.shadowBlur = 0;
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const theta = (i / steps) * Math.PI * 2 + phase;
        const wv = this.sampleRadialWave(theta);
        const r = (rBase + wv * amp * 0.65) * scale;
        const x = cx + Math.cos(theta) * r;
        const y = cy + Math.sin(theta) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }

    // 4. Crisp wavy outer edge — bright white, the defining silhouette of the sphere.
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = "rgba(255,255,255,0.92)";
    ctx.lineWidth = 2.6;
    ctx.shadowBlur = 14;
    ctx.shadowColor = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    this.buildWavyPath(pts);
    ctx.stroke();
    ctx.restore();

    // 5. Warm rim-light on the upper arc (specular highlight from above-light).
    //    Theta 3π/2 is the top in canvas coords (y+ is down), so step ratio 0.75 = top.
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = "rgba(255, 215, 180, 0.7)";
    ctx.lineWidth = 4.6;
    ctx.shadowBlur = 24;
    ctx.shadowColor = "rgba(255, 110, 50, 0.95)";
    ctx.beginPath();
    const topI0 = Math.floor(steps * 0.58);
    const topI1 = Math.floor(steps * 0.92);
    for (let i = topI0; i <= topI1; i++) {
      const p = pts[i]!;
      if (i === topI0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.restore();

    // 6. Cool rim-light on the lower arc.
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = "rgba(180, 215, 255, 0.6)";
    ctx.lineWidth = 4.2;
    ctx.shadowBlur = 22;
    ctx.shadowColor = "rgba(40, 130, 255, 0.95)";
    ctx.beginPath();
    const botI0 = Math.floor(steps * 0.08);
    const botI1 = Math.floor(steps * 0.42);
    for (let i = botI0; i <= botI1; i++) {
      const p = pts[i]!;
      if (i === botI0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.restore();
  };
}
