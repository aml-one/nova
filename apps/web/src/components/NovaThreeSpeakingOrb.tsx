"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { AIVoiceOrb, type VoiceOrbPresetName } from "../lib/ai-voice-orb/AIVoiceOrb";

export type NovaThreeSpeakingOrbHandle = {
  setSpeechLevel: (level: number) => void;
  setSpeechEnvelope: (smooth: number, peak: number) => void;
  setRotationSpeed: (speed: number) => void;
  randomizeDirection: () => void;
  setMoodPalette: (colorA: string, colorB: string, shellRgb: string, glowHex: string) => void;
};

type Props = {
  className?: string;
  baseColor?: string;
  preset?: VoiceOrbPresetName;
};

/**
 * WebGL speaking orb: organic Perlin sphere (after brunosimon/organic-sphere), driven by TTS levels.
 * Mount must have non-zero width/height before construction.
 */
export const NovaThreeSpeakingOrb = forwardRef<NovaThreeSpeakingOrbHandle, Props>(function NovaThreeSpeakingOrb(
  { className, baseColor = "#42b9ff", preset = "speaking" },
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
    }
  }));

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const orb = new AIVoiceOrb(el, { radius: 1.85, baseColor });
    orbRef.current = orb;
    return () => {
      try {
        orb.dispose();
      } catch {
        // Ignore double-dispose / DOM races.
      }
      orbRef.current = null;
    };
  }, [baseColor]);

  useEffect(() => {
    orbRef.current?.applyPreset(preset);
  }, [preset]);

  return <div ref={hostRef} className={className} style={{ width: "100%", height: "100%", minHeight: "120px" }} />;
});

NovaThreeSpeakingOrb.displayName = "NovaThreeSpeakingOrb";
