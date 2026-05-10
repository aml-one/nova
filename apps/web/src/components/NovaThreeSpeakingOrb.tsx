"use client";

import { Bebas_Neue } from "next/font/google";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { NovaReactiveOrb2D, type VoiceOrbPresetName } from "../lib/nova-reactive-orb/NovaReactiveOrb2D";

/** Matches `Nova_Orb` / `style.css` title (Bebas Neue, centered “NOVA”). */
const novaOrbTitle = Bebas_Neue({
  weight: "400",
  subsets: ["latin"],
  display: "swap"
});

export type NovaThreeSpeakingOrbHandle = {
  setSpeechLevel: (level: number) => void;
  setSpeechEnvelope: (smooth: number, peak: number) => void;
  /** Live FFT snapshot from `AnalyserNode` (TTS); drives per-angle displacement like standalone Nova_Orb. */
  setSpectrum: (freqBytes: Uint8Array<ArrayBuffer>) => void;
  setRotationSpeed: (speed: number) => void;
  randomizeDirection: () => void;
  setMoodPalette: (colorA: string, colorB: string, shellRgb: string, glowHex: string) => void;
  setPresentationIdleCalm: (calm: boolean) => void;
};

type Props = {
  className?: string;
  baseColor?: string;
  preset?: VoiceOrbPresetName;
  /** Canvas clears to transparent so the host background shows through. */
  transparentBackground?: boolean;
  /** Near-static surface + slow scale pulse (e.g. kiosk when not speaking). */
  presentationIdleCalm?: boolean;
  /** Same as standalone Nova_Orb sample: centered title inside the ring. */
  showNovaTitle?: boolean;
};

/**
 * 2D reactive voice ring (Nova_Orb-style): spectrum-driven displacements, warm/cool gradient, transparent.
 * Mount must have non-zero width/height before construction.
 */
export const NovaThreeSpeakingOrb = forwardRef<NovaThreeSpeakingOrbHandle, Props>(function NovaThreeSpeakingOrb(
  {
    className,
    baseColor = "#ff3d26",
    preset = "speaking",
    transparentBackground = true,
    presentationIdleCalm,
    showNovaTitle = true
  },
  ref
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const orbRef = useRef<NovaReactiveOrb2D | null>(null);

  useImperativeHandle(ref, () => ({
    setSpeechLevel: (level: number) => {
      orbRef.current?.setSpeechLevel(level);
    },
    setSpeechEnvelope: (smooth: number, peak: number) => {
      orbRef.current?.setSpeechEnvelope(smooth, peak);
    },
    setSpectrum: (freqBytes: Uint8Array<ArrayBuffer>) => {
      orbRef.current?.setSpectrum(freqBytes);
    },
    setRotationSpeed: (speed: number) => {
      orbRef.current?.setRotationSpeed(speed);
    },
    randomizeDirection: () => {
      orbRef.current?.randomizeDirection();
    },
    setMoodPalette: (colorA: string, colorB: string, shellRgb: string, glowHex: string) => {
      orbRef.current?.setMoodPalette(colorA, colorB, shellRgb, glowHex);
    },
    setPresentationIdleCalm: (calm: boolean) => {
      orbRef.current?.setPresentationIdleCalm(calm);
    }
  }));

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const orb = new NovaReactiveOrb2D(el, {
      baseColor,
      transparentBackground
    });
    orbRef.current = orb;
    return () => {
      try {
        orb.dispose();
      } catch {
        // Ignore double-dispose / DOM races.
      }
      orbRef.current = null;
    };
  }, [baseColor, transparentBackground]);

  useEffect(() => {
    const orb = orbRef.current;
    if (!orb) return;
    orb.setPresentationIdleCalm(presentationIdleCalm ?? false);
    orb.applyPreset(preset);
  }, [preset, presentationIdleCalm, baseColor, transparentBackground]);

  return (
    <div
      ref={hostRef}
      className={className}
      style={{ position: "relative", width: "100%", height: "100%", minHeight: "120px" }}
    >
      {showNovaTitle ? (
        <div
          className="pointer-events-none absolute inset-0 z-[1] grid place-items-center"
          aria-hidden
        >
          <span
            className={novaOrbTitle.className}
            style={{
              margin: 0,
              padding: 0,
              fontSize: "clamp(2.2rem, 18vw, 5.5rem)",
              letterSpacing: "clamp(0.24rem, 1.3vw, 1.1rem)",
              lineHeight: 1,
              color: "rgba(255, 255, 255, 0.92)",
              textAlign: "center",
              textShadow:
                "0 0 4px rgba(255, 255, 255, 0.35), 0 0 26px rgba(255, 255, 255, 0.08)",
              mixBlendMode: "screen"
            }}
          >
            NOVA
          </span>
        </div>
      ) : null}
    </div>
  );
});

NovaThreeSpeakingOrb.displayName = "NovaThreeSpeakingOrb";
