"use client";

// Story wrapper (§4.9.2, §6.2): hero (beat 0) and the seven steps share ONE sticky stage and one WebGL context.
// The DOM carries the meaning: step text is real HTML, the active step gets aria-current="step", the wrapper exposes
// data-beat for tests. Scroll → a continuous beat in a ref (rAF-throttled, no React render per frame); React state
// changes only when the integer beat changes. The canvas mounts after first idle, never under reduced motion.
import dynamic from "next/dynamic";
import { Pause, Play } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { beatFromBlocks } from "./three/keyframes";
import { decideTier, readTierInputs, readUserOff, writeUserOff, type Tier } from "./three/tier";
import { LoopStill } from "./loop-still";
import { cn } from "cn";

const LoopStage = dynamic(() => import("./three/LoopStage"), { ssr: false });

export interface StoryStep {
  title: string;
  body: string;
}

export function StoryWrapper({ hero, steps }: { hero: React.ReactNode; steps: readonly StoryStep[] }) {
  const wrapper = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const blocks = useRef<(HTMLElement | null)[]>([]);
  const beatRef = useRef(0);
  // Filled by the lazy stage (R3F root invalidate) so this chunk never imports three or R3F (D8).
  const invalidateRef = useRef<() => void>(() => {});
  const [beat, setBeat] = useState(0);
  const [tier, setTier] = useState<Tier | null>(null);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(true);
  const [ready, setReady] = useState(false);
  const [mount, setMount] = useState(false);

  // Tier: decided once, after first idle (H1 stays the LCP element; the still holds the space).
  useEffect(() => {
    const decide = () => {
      const t = decideTier(readTierInputs());
      setTier(t);
      setPaused(false);
      if (t > 0) setMount(true);
    };
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(decide);
    else setTimeout(decide, 300);
  }, []);

  // Scroll → continuous beat (pure beatFromBlocks), rAF-throttled.
  useEffect(() => {
    let raf = 0;
    const read = () => {
      raf = 0;
      const vh = window.innerHeight;
      const rects = blocks.current.map((b) => {
        const r = b?.getBoundingClientRect();
        return [r?.top ?? Infinity, r?.height ?? 1] as const;
      });
      const b = beatFromBlocks(rects, vh * 0.45);
      beatRef.current = b;
      const whole = Math.min(7, Math.floor(b));
      setBeat((prev) => (prev === whole ? prev : whole));
      // Stage background: inverse (hero) → page background between beat 0 and 1 (no React render).
      stage.current?.style.setProperty("--stage-mix", `${Math.min(1, Math.max(0, b - 0.45) / 0.55) * 100}%`);
      invalidateRef.current();
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // 0 frames when the stage is off-screen or the tab is hidden.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(!!e?.isIntersecting && document.visibilityState === "visible"));
    io.observe(el);
    const onVis = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const drop = useCallback(() => setTier((t) => (t === 2 ? 1 : 0)), []);
  const lost = useCallback(() => setTier(0), []);
  const togglePause = () => {
    const next = !paused;
    setPaused(next);
    writeUserOff(next);
  };

  const live = tier === 1 || tier === 2;
  const state = !live ? "static" : paused ? "paused" : "running";

  return (
    <section
      ref={wrapper}
      data-story
      data-beat={beat}
      aria-label="How Dueloop works"
      className="story relative grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
    >
        <div
          ref={(el) => {
            blocks.current[0] = el;
          }}
          data-story-block={0}
          id="top"
          className="on-inverse row-start-1 flex min-h-[calc(100svh-56px)] lg:col-start-1 flex-col justify-center gap-6 bg-inverse gutter py-16 text-ink-inverse lg:min-h-svh lg:bg-transparent lg:pt-28 lg:pr-12 lg:pl-[max(var(--gutter),calc((100vw-var(--content-max))/2+var(--gutter)))]"
        >
          {hero}
        </div>
        <div className="row-start-3 gutter lg:col-start-1 lg:row-start-2 lg:pr-12 lg:pl-[max(var(--gutter),calc((100vw-var(--content-max))/2+var(--gutter)))]">
          <h2 id="how" tabIndex={-1} className="pt-16 t-label text-brand">
            How it works
          </h2>
          <p className="t-display-lg mt-2 max-w-md">From import to paid, in seven calm steps.</p>
          <ol className="mt-6 grid">
            {steps.map((s, i) => (
              <li
                key={s.title}
                ref={(el) => {
                  blocks.current[i + 1] = el;
                }}
                data-story-block={i + 1}
                aria-current={beat === i + 1 ? "step" : undefined}
                className="story-step flex min-h-[70vh] items-center py-8 lg:min-h-[80vh]"
              >
                <div
                  className={cn(
                    "grid w-full gap-2 rounded-xl border p-5 transition-colors-fast md:p-6",
                    beat === i + 1 ? "border-line-control bg-panel text-ink shadow-elev-1" : "border-line bg-panel text-ink-muted",
                  )}
                >
                  <h3 className="t-heading-md text-ink">
                    <span className="tabular-nums text-brand">{i + 1}</span> · {s.title}
                  </h3>
                  <p className="t-body-lg prose-width">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="h-[30vh]" aria-hidden="true" />
        </div>

      <div className="sticky top-14 z-(--z-raised) row-start-2 h-[42svh] md:h-[46svh] lg:top-[72px] lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:h-[calc(100svh-96px)] lg:self-start lg:pt-0">
        <div
          ref={stage}
          data-tier={tier ?? "pending"}
          data-3d-state={state}
          className="stage relative h-full w-full overflow-hidden lg:rounded-2xl"
        >
          {/* Tier 0 and the server render: one still per beat (cross-fade on beat change; instant with reduced motion). */}
          <div className={cn("absolute inset-0 grid place-items-center", live && ready && "opacity-0")} aria-hidden="true">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((b) => (
              <LoopStill
                key={b}
                beat={b}
                priority={b === 0}
                className={cn("still absolute h-full w-full object-contain", (live ? 0 : beat) === b ? "opacity-100" : "opacity-0")}
              />
            ))}
          </div>
          {mount && live ? (
            <div className={cn("canvas-fade absolute inset-0", ready ? "opacity-100" : "opacity-0")}>
              <LoopStage
                beatRef={beatRef}
                tier={tier as 1 | 2}
                onInvalidate={(fn) => {
                  invalidateRef.current = fn;
                }}
                paused={paused}
                visible={visible}
                onFirstFrame={() => setReady(true)}
                onTierDrop={drop}
                onContextLost={lost}
              />
            </div>
          ) : null}
          {tier !== null ? (
            <button
              type="button"
              onClick={live ? togglePause : () => {
                writeUserOff(false);
                const t = decideTier({ ...readTierInputs(), userOff: false });
                setTier(t);
                if (t > 0) setMount(true);
              }}
              aria-pressed={live ? paused : undefined}
              disabled={!live && !readUserOff()}
              className="press absolute right-3 bottom-3 z-(--z-raised) inline-flex min-h-11 items-center gap-2 rounded-full bg-inverse-raised px-4 t-caption font-semibold text-ink-inverse hover:brightness-110 disabled:opacity-80"
            >
              {live && !paused ? <Pause aria-hidden="true" className="size-4" /> : <Play aria-hidden="true" className="size-4" />}
              {live ? (paused ? "Play animation" : "Pause animation") : "Animation off"}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
