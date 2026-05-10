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
   * Hard inner limit (the “red circle”): inner wavy edge never crosses inside this radius.
   * Expressed as a fraction of half the shorter canvas side (0–1).
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
 * 2D neon ring: wavy inner/outer boundaries, fixed overall extent, no whole-object scale pulse.
 * Inner edge is clamped so it never crosses `innerHoleRadiusNorm` (clear center).
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
    this.innerHoleNorm = options.innerHoleRadiusNorm ?? 0.4;
    this.canvas = document.createElement("canvas");
    this.canvas.style.display = "block";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    if (options.transparentBackground === true) {
      this.canvas.style.background = "transparent";
    }
    const c = this.canvas.getContext("2d", { alpha: true });
    if (!c) {
      throw new Error("2D canvas unsupported");
    }
    this.ctx = c;
    this.mount.style.position = "relative";
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
    // Anchor to reference art: electric cyan (BL) ↔ hot orange (TR), accent only nudges hue.
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

  private sampleWaves(theta: number): { inner: number; outer: number } {
    const t = this.timeSec;
    const k = this.noiseSeed;
    // Lower high-frequency weight → smoother, more “liquid” silhouette (closer to reference).
    const s0 = Math.sin(theta * 3 + t * 0.95 + k);
    const s1 = Math.sin(theta * 6 - t * 0.58 + k * 1.2);
    const s2 = Math.sin(theta * 9 + t * 1.05 + k * 0.35);
    const inner = s0 * 0.52 + s1 * 0.32 + s2 * 0.16;

    const o0 = Math.cos(theta * 4 + t * 0.72 + k * 0.65);
    const o1 = Math.cos(theta * 10 - t * 0.44 + k);
    const o2 = Math.sin(theta * 14 + t * 0.5);
    const outer = o0 * 0.54 + o1 * 0.32 + o2 * 0.14;
    return { inner, outer };
  }

  private ringPath(ctx: CanvasRenderingContext2D, outerPts: { x: number; y: number }[], innerPts: { x: number; y: number }[]): void {
    const p0 = outerPts[0]!;
    ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < outerPts.length; i++) {
      const p = outerPts[i]!;
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.moveTo(innerPts[innerPts.length - 1]!.x, innerPts[innerPts.length - 1]!.y);
    for (let i = innerPts.length - 2; i >= 0; i--) {
      const p = innerPts[i]!;
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
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
    this.gradientAngle += this.rotationSpeed * dt;

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
    // Narrow band (~10–12% of radius): reads like the thin neon tube in the reference, not a thick donut.
    const rOuterMean = half * 0.845;
    const bandWidth = half * 0.108;
    const rInnerMean = Math.max(rHole + half * 0.014, rOuterMean - bandWidth);

    const e = this.energy();
    const idleBreath = this.presentationIdleCalm ? 0.12 + Math.sin(this.timeSec * 0.85) * 0.08 : 0;
    const waveBoost = this.presentationIdleCalm ? idleBreath : e;

    const band = Math.max(rOuterMean - rInnerMean, half * 0.04);
    const innerAmp = band * (0.14 + waveBoost * 0.55);
    const outerAmp = band * (0.2 + waveBoost * 0.72);
    const minWall = half * 0.006;

    const steps = 360;
    const outerPts: { x: number; y: number }[] = [];
    const innerPts: { x: number; y: number }[] = [];

    for (let i = 0; i <= steps; i++) {
      const theta = (i / steps) * Math.PI * 2;
      const { inner, outer } = this.sampleWaves(theta);

      let ri = rInnerMean + inner * innerAmp;
      ri = Math.max(rHole, ri);

      let ro = rOuterMean + outer * outerAmp;
      if (ro < ri + minWall) {
        ro = ri + minWall;
      }

      outerPts.push({ x: cx + Math.cos(theta) * ro, y: cy + Math.sin(theta) * ro });
      innerPts.push({ x: cx + Math.cos(theta) * ri, y: cy + Math.sin(theta) * ri });
    }

    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);

    const cos = Math.cos(this.gradientAngle);
    const sin = Math.sin(this.gradientAngle);
    // Bottom-left → top-right (reference “organic sphere” poster).
    const x0 = cx - cos * half - sin * half;
    const y0 = cy - sin * half + cos * half;
    const x1 = cx + cos * half + sin * half;
    const y1 = cy + sin * half - cos * half;

    const B = this.moodB;
    const A = this.moodA;
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, rgbStr(B.r, B.g, B.b, 1));
    g.addColorStop(0.28, rgbStr(lerp(B.r, 255, 0.55), lerp(B.g, 255, 0.55), lerp(B.b, 255, 0.45), 1));
    g.addColorStop(0.42, rgbStr(lerp(B.r, 255, 0.82), lerp(B.g, 255, 0.82), lerp(B.b, 255, 0.78), 1));
    g.addColorStop(0.52, rgbStr(255, 255, 255, 1));
    g.addColorStop(0.62, rgbStr(255, lerp(255, A.g, 0.12), lerp(255, A.b, 0.08), 1));
    g.addColorStop(0.78, rgbStr(lerp(255, A.r, 0.35), lerp(255, A.g, 0.25), lerp(255, A.b, 0.2), 1));
    g.addColorStop(1, rgbStr(A.r, A.g, A.b, 1));

    // Wide bloom (soft halo) — slightly transparent so the second pass defines the crisp tube.
    ctx.save();
    ctx.globalAlpha = 0.78;
    ctx.shadowBlur = 44 + waveBoost * 36;
    ctx.shadowColor = rgbStr(lerp(B.r, A.r, 0.5), lerp(B.g, A.g, 0.5), lerp(B.b, A.b, 0.55), 0.52);
    ctx.beginPath();
    this.ringPath(ctx, outerPts, innerPts);
    ctx.fillStyle = g;
    ctx.fill("evenodd");
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 14 + waveBoost * 20;
    ctx.shadowColor = rgbStr(255, 252, 255, 0.48);
    ctx.beginPath();
    this.ringPath(ctx, outerPts, innerPts);
    ctx.fillStyle = g;
    ctx.fill("evenodd");
    ctx.restore();

    // Crisp outer highlight (white plasma edge).
    ctx.save();
    ctx.strokeStyle = rgbStr(255, 255, 255, 0.38 + waveBoost * 0.32);
    ctx.lineWidth = 1.15;
    ctx.shadowBlur = 10;
    ctx.shadowColor = "rgba(255,255,255,0.55)";
    ctx.beginPath();
    for (let i = 0; i < outerPts.length; i++) {
      const p = outerPts[i]!;
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = rgbStr(255, 255, 255, 0.14 + waveBoost * 0.22);
    ctx.lineWidth = 0.85;
    ctx.beginPath();
    for (let i = 0; i < innerPts.length; i++) {
      const p = innerPts[i]!;
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  };
}
