// Quality tiers (§6.2.3). Decided once at mount; can only go DOWN at runtime (watchdog, context loss, pause).

export type Tier = 0 | 1 | 2;

export interface TierInputs {
  reducedMotion: boolean;
  webgl2: boolean;
  saveData: boolean;
  /** The visitor switched animation off before (localStorage dl-3d=off). */
  userOff: boolean;
  viewportWidth: number;
  cores: number | undefined;
  /** navigator.deviceMemory (non-standard; undefined where it does not exist). */
  memoryGb: number | undefined;
}

export function decideTier(i: TierInputs): Tier {
  if (i.reducedMotion || !i.webgl2 || i.saveData || i.userOff) return 0;
  const strongCpu = (i.cores ?? 0) > 4;
  const enoughMemory = i.memoryGb === undefined || i.memoryGb > 4;
  if (i.viewportWidth >= 1024 && strongCpu && enoughMemory) return 2;
  return 1;
}

/** FPS floor per tier; below it for a rolling 3 s window, the scene drops one tier. */
export const FPS_FLOOR: Record<Exclude<Tier, 0>, number> = { 2: 40, 1: 30 };
export const WATCHDOG_WINDOW_MS = 3000;

/** Rolling-window FPS check. Pure state machine: feed frame deltas, get "drop" when the window average is too low. */
export function watchdogStep(state: { elapsed: number; frames: number }, deltaMs: number, tier: Tier): { state: { elapsed: number; frames: number }; drop: boolean } {
  if (tier === 0) return { state, drop: false };
  const next = { elapsed: state.elapsed + deltaMs, frames: state.frames + 1 };
  if (next.elapsed < WATCHDOG_WINDOW_MS) return { state: next, drop: false };
  const fps = (next.frames * 1000) / next.elapsed;
  return { state: { elapsed: 0, frames: 0 }, drop: fps < FPS_FLOOR[tier] };
}

export const PREF_KEY = "dl-3d";

export function readUserOff(): boolean {
  try {
    return window.localStorage.getItem(PREF_KEY) === "off";
  } catch {
    return false;
  }
}

export function writeUserOff(off: boolean): void {
  try {
    if (off) window.localStorage.setItem(PREF_KEY, "off");
    else window.localStorage.removeItem(PREF_KEY);
  } catch {
    // storage blocked (private mode): the choice lasts for this visit only
  }
}

/** Browser inputs for decideTier. WebGL2 is probed on a throwaway canvas. */
export function readTierInputs(): TierInputs {
  let webgl2: boolean;
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2");
    webgl2 = !!gl;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    webgl2 = false;
  }
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  return {
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    webgl2,
    saveData: nav.connection?.saveData === true,
    userOff: readUserOff(),
    viewportWidth: window.innerWidth,
    cores: nav.hardwareConcurrency,
    memoryGb: nav.deviceMemory,
  };
}
