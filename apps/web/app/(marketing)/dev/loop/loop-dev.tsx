"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

const LoopStage = dynamic(() => import("@/features/landing/three/LoopStage"), { ssr: false });

/** Renders the scene at a fixed beat; data-ready="1" once the first frame is drawn (the stills script waits on it). */
export function LoopDev({ beat, still, size }: { beat: number; still: boolean; size: number }) {
  // The middle of the beat, except the hero (its resting state) and Close (the loop closed, ring green again).
  const at = beat === 0 ? 0.2 : beat === 7 ? 7.97 : beat + 0.45;
  const beatRef = useRef(at);
  const [ready, setReady] = useState(false);
  // Stills are rendered on a transparent background (WebP keeps alpha) so they sit on any surface without a seam;
  // ?bg=1 shows the stage colour for looking at a beat by eye.
  const [bg, setBg] = useState("transparent");
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("bg") === "1") setBg(beat === 0 ? "var(--color-surface-inverse)" : "var(--color-bg)");
    else {
      document.documentElement.style.background = "transparent";
      document.body.style.background = "transparent";
    }
  }, [beat]);
  return (
    <div id="loop-dev" data-ready={ready ? "1" : "0"} style={{ width: size, height: size, position: "relative", background: bg }}>
      <LoopStage
        beatRef={beatRef}
        tier={2}
        paused={still}
        visible
        frozen={still ? { beat: at } : null}
        preserveDrawingBuffer
        onFirstFrame={() => setTimeout(() => setReady(true), 300)}
      />
    </div>
  );
}
