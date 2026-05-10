"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { AIVoiceOrb, type VoiceOrbPresetName } from "../lib/ai-voice-orb/AIVoiceOrb";

export type NovaThreeSpeakingOrbHandle = {
  setSpeechLevel: (level: number) => void;
  setSpeechEnvelope: (smooth: number, peak: number) => void;
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
 * WebGL speaking orb: organic Perlin sphere (after brunosimon/organic-sphere), driven by TTS levels.
 * Mount must have non-zero width/height before construction.
 */
export const NovaThreeSpeakingOrb = forwardRef<NovaThreeSpeakingOrbHandle, Props>(function NovaThreeSpeakingOrb(
  { className, baseColor = "#ff3d26", preset = "speaking", transparentBackground, presentationIdleCalm },
  ref
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const orbRef = useRef<AIVoiceOrb | null>(null);

  useImperativeHandle(ref, () => ({
    setSpeechLevel: (level: number) => {
      orbRef.current?.setSpeechLevel(level);
    },
    setSpeechEnvelope: (smooth: number, peak: number) => {
      orbRef.current?.setSpeechEnvelope(smooth, peak);
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
    const orb = new AIVoiceOrb(el, {
      radius: 1.85,
      baseColor,
      transparentBackground: transparentBackground === true
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
