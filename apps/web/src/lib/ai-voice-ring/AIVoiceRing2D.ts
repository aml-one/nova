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

  private moodA = parseHex("#ff2200");
  private moodB = parseHex("#00c8ff");
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
    const warm = {
      r: Math.round(34 + (accent.r - 34) * 0.26),
      g: Math.round(34 + (accent.g - 34) * 0.26),
      b: Math.round(8 + (accent.b - 8) * 0.26)
    };
    const cool = {
      r: Math.round(0 + (accent.r - 0) * 0.32),
      g: Math.round(136 + (accent.g - 136) * 0.32),
      b: Math.round(255 + (accent.b - 255) * 0.32)
    };
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
    const s0 = Math.sin(theta * 3 + t * 0.95 + k);
    const s1 = Math.sin(theta * 7 - t * 0.62 + k * 1.3);
    const s2 = Math.sin(theta * 11 + t * 1.15 + k * 0.4);
    const inner = s0 * 0.48 + s1 * 0.32 + s2 * 0.2;

    const o0 = Math.cos(theta * 5 + t * 0.78 + k * 0.7);
    const o1 = Math.cos(theta * 13 - t * 0.48 + k);
    const o2 = Math.sin(theta * 17 + t * 0.55);
    const outer = o0 * 0.5 + o1 * 0.35 + o2 * 0.15;
    return { inner, outer };
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
    const rOuterMean = half * 0.92;
    const ringThickness = rOuterMean - rHole;
    const rInnerMean = rHole + ringThickness * 0.22;

    const e = this.energy();
    const idleBreath = this.presentationIdleCalm ? 0.12 + Math.sin(this.timeSec * 0.85) * 0.08 : 0;
    const waveBoost = this.presentationIdleCalm ? idleBreath : e;

    const innerAmp = half * (0.014 + waveBoost * 0.052);
    const outerAmp = half * (0.022 + waveBoost * 0.078);
    const minWall = half * 0.018;

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
    const x0 = cx - cos * half - sin * half;
    const y0 = cy - sin * half + cos * half;
    const x1 = cx + cos * half + sin * half;
    const y1 = cy + sin * half - cos * half;
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, rgbStr(this.moodB.r, this.moodB.g, this.moodB.b, 1));
    g.addColorStop(0.45, rgbStr(255, 250, 245, 0.92));
    g.addColorStop(1, rgbStr(this.moodA.r, this.moodA.g, this.moodA.b, 1));

    ctx.save();
    ctx.shadowBlur = 18 + waveBoost * 28;
    ctx.shadowColor = rgbStr(
      (this.moodA.r + this.moodB.r) * 0.5,
      (this.moodA.g + this.moodB.g) * 0.5,
      (this.moodA.b + this.moodB.b) * 0.5,
      0.55
    );

    ctx.beginPath();
    {
      const p0 = outerPts[0]!;
      ctx.moveTo(p0.x, p0.y);
      for (let i = 1; i < outerPts.length; i++) {
        const p = outerPts[i]!;
        ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
    }
    ctx.moveTo(innerPts[innerPts.length - 1]!.x, innerPts[innerPts.length - 1]!.y);
    for (let i = innerPts.length - 2; i >= 0; i--) {
      const p = innerPts[i]!;
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();

    ctx.fillStyle = g;
    ctx.fill("evenodd");
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = rgbStr(255, 255, 255, 0.22 + waveBoost * 0.35);
    ctx.lineWidth = 1.25;
    ctx.shadowBlur = 8;
    ctx.shadowColor = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    for (let i = 0; i < outerPts.length; i++) {
      const p = outerPts[i]!;
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  };
}
