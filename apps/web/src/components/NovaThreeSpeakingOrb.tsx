"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { NovaReactiveOrb2D, type VoiceOrbPresetName } from "../lib/nova-reactive-orb/NovaReactiveOrb2D";

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
  /** WebGL clears to transparent so the host background shows through. */
  transparentBackground?: boolean;
  /** Near-static surface + slow scale pulse (e.g. kiosk when not speaking). */
  presentationIdleCalm?: boolean;
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
    presentationIdleCalm
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

  return <div ref={hostRef} className={className} style={{ width: "100%", height: "100%", minHeight: "120px" }} />;
});

NovaThreeSpeakingOrb.displayName = "NovaThreeSpeakingOrb";
