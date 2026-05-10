/** Default TTS orb palette (restored on detach) — warm / cool split like organic-sphere reference art. */
export const NOVA_ORB_MOOD_DEFAULT_A = "#ff3310";
export const NOVA_ORB_MOOD_DEFAULT_B = "#0096ff";
export const NOVA_ORB_MOOD_DEFAULT_SHELL = "#12041c";
export const NOVA_ORB_MOOD_DEFAULT_GLOW = "#5c1d8c";

function hexToRgbChannels(hex: string): [number, number, number] {
  const h = hex.trim().replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  if (!Number.isFinite(n)) return [94, 200, 255];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function lerpHexColor(a: string, b: string, t: number): string {
  const u = Math.max(0, Math.min(1, t));
  const [ar, ag, ab] = hexToRgbChannels(a);
  const [br, bg, bb] = hexToRgbChannels(b);
  const r = Math.round(ar + (br - ar) * u);
  const g = Math.round(ag + (bg - ag) * u);
  const bch = Math.round(ab + (bb - ab) * u);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${bch.toString(16).padStart(2, "0")}`;
}

/** TTS orb accent follows Nova unified emotion (not raw audio crest). */
export function orbMoodPaletteForEmotionLabel(label: string): {
  a: string;
  b: string;
  shell: string;
  glow: string;
} {
  const L = label.trim().toLowerCase();
  switch (L) {
    case "angry":
      return { a: "#ff3355", b: "#ffc0c8", shell: "#cc2233", glow: "#ff4455" };
    case "frustrated":
      return { a: "#6d28d9", b: "#ddd6fe", shell: "#5b21b6", glow: "#a78bfa" };
    case "sad":
    case "anxious":
    case "guilty":
      return { a: "#7e22ce", b: "#e9d5ff", shell: "#581c87", glow: "#c084fc" };
    case "loving":
    case "empathetic":
      return { a: "#ec4899", b: "#fce7f3", shell: "#be185d", glow: "#f472b6" };
    case "joyful":
      return { a: "#22c55e", b: "#bbf7d0", shell: "#166534", glow: "#4ade80" };
    case "curious":
      return { a: "#eab308", b: "#fef9c3", shell: "#a16207", glow: "#fde047" };
    default:
      return {
        a: NOVA_ORB_MOOD_DEFAULT_A,
        b: NOVA_ORB_MOOD_DEFAULT_B,
        shell: NOVA_ORB_MOOD_DEFAULT_SHELL,
        glow: NOVA_ORB_MOOD_DEFAULT_GLOW
      };
  }
}
