"use client";

// The single <Canvas> (one WebGL context for the whole page, §6.2.2). Loaded lazily with next/dynamic (ssr: false)
// only on the landing page. Props verified against node_modules/@react-three/fiber 9.8.2 (Canvas: frameloop, dpr, gl,
// camera, fallback; invalidate exported from the package).
import { Canvas } from "@react-three/fiber";
import type { MutableRefObject } from "react";
import { LoopScene } from "./LoopScene";
import type { Tier } from "./tier";

export interface LoopStageProps {
  beatRef: MutableRefObject<number>;
  tier: Exclude<Tier, 0>;
  paused: boolean;
  visible: boolean;
  frozen?: { beat: number } | null;
  onFirstFrame?: () => void;
  onTierDrop?: () => void;
  onContextLost?: () => void;
  /** Receives the root's invalidate (for "demand" frames on scroll while paused). */
  onInvalidate?: (fn: () => void) => void;
  /**
   * Keep the drawing buffer. On by default: when paused ("demand", no new frames) the last frame must stay readable,
   * otherwise a re-composite or screenshot can read an empty buffer (seen in the D17 check with software WebGL).
   */
  preserveDrawingBuffer?: boolean;
}

export default function LoopStage({ beatRef, tier, paused, visible, frozen, onFirstFrame, onTierDrop, onContextLost, onInvalidate, preserveDrawingBuffer = true }: LoopStageProps) {
  return (
    <Canvas
      aria-hidden="true"
      frameloop={!visible ? "never" : paused || frozen ? "demand" : "always"}
      dpr={tier === 2 ? [1, 1.75] : [1, 1.25]}
      gl={{ antialias: tier === 2, powerPreference: "low-power", alpha: true, preserveDrawingBuffer }}
      camera={{ fov: 35, position: [0, 1.2, 9] }}
      style={{ position: "absolute", inset: 0, touchAction: "pan-y" }}
      onCreated={({ gl, invalidate }) => {
        gl.setClearColor(0x000000, 0);
        onInvalidate?.(() => invalidate());
        gl.domElement.addEventListener("webglcontextlost", (e) => {
          e.preventDefault();
          onContextLost?.();
        });
      }}
    >
      <LoopScene beatRef={beatRef} tier={tier} paused={paused} frozen={frozen ?? null} onFirstFrame={onFirstFrame} onTierDrop={onTierDrop} />
    </Canvas>
  );
}
