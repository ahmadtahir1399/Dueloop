// The Loop (redesign §6.2.4) as DATA plus pure functions. Everything the scene shows is a function of
// (beat, time): beat ∈ [0, 8) comes from scroll (0 = hero, 1–7 = steps), time from the clock for ambient motion only.
// One-shot moments are driven by the LOCAL progress inside their beat, so scrolling back plays them in reverse.
// No three.js imports here: plain numbers, unit-tested in test/landing-keyframes.test.ts.

export type Vec3 = readonly [number, number, number];

export const BEAT_COUNT = 8;

/** Colours from the token table (§3.1.1). The scene files are the only place hex may appear outside tokens.css. */
export const COLORS = {
  stone: "#EEF0EC",
  warm: "#ADDBC0",
  evergreen: "#4DA477",
  barStone: "#C3C9C1",
  barGreen: "#1F6E48",
  promised: "#BBD0F7",
  lime: "#C8F169",
  ink: "#0A2318",
  inverse: "#0A2318",
  bg: "#F7F8F6",
  rail: "#C3C9C1",
  prop: "#1F6E48",
  paper: "#FFFFFF",
} as const;

/**
 * tiltX: the spec says "group tilt X −18°" meaning "tilted toward the viewer". In three.js a negative X rotation
 * shows the ring from BELOW (the back cards sit lower than the front ones; seen in the first stills), so the
 * implementation uses +18°, which gives the intended view from slightly above (CONFLICTS C-31).
 */
export const RING = { radius: 3.2, tiltX: (18 * Math.PI) / 180, periodMs: 60_000, cardsFull: 12, cardsLite: 8 } as const;
export const CARD = { width: 1.0, height: 1.32, radius: 0.08, depth: 0.03 } as const;

/** Camera position and look-at target per beat (the §6.2.4 table). */
export const CAMERA: readonly [{ position: Vec3; target: Vec3 }, ...{ position: Vec3; target: Vec3 }[]] = [
  { position: [0, 1.2, 9], target: [0, 0, 0] },
  { position: [-1.4, 1.0, 6.5], target: [-0.4, -0.35, 0] },
  { position: [0, 1.4, 6.0], target: [0, -0.35, 0] },
  { position: [0.8, 1.1, 5.5], target: [0.1, -0.3, 0] },
  { position: [1.5, 1.4, 6.5], target: [1.2, 0.5, 0] },
  { position: [0.5, 1.0, 5.8], target: [0, 0, 0] },
  { position: [0, 1.1, 5.2], target: [0, 0, 0] },
  { position: [0, 1.4, 9], target: [0, 0, 0] },
];

/** Where the story card stands during each beat (beat 1 adds the lift out of the sheet; beat 0 and 7 = ring front). */
/** The ring's front slot in world space (ring group at the origin, tilted about X). */
export const RING_FRONT: Vec3 = [0, -RING.radius * Math.sin(RING.tiltX), RING.radius * Math.cos(RING.tiltX)];
const CARD_SPOT: readonly Vec3[] = [RING_FRONT, [-0.4, -0.5, 0.15], [-1.2, -0.2, 0], [0, -0.2, 0], [0, -0.2, 0], [0, 0, 0], [0, 0, 0], RING_FRONT];

/** The timeline's three stations as fractions of the rail, so the lime fill stops exactly on each one. */
export const RAIL = { length: 4.2, stations: [-1.2, 0, 1.2] } as const;
const stationFill = (x: number) => (x + RAIL.length / 2) / RAIL.length;

export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
/** smoothstep(e0, e1, x): 0 below e0, 1 above e1, smooth between. */
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
/** ease-settle (§3.7, cubic-bezier(0.34, 1.36, 0.64, 1)) approximated as a back-out curve: slight overshoot. */
export const settle = (t: number) => {
  const x = clamp(t);
  const c = 1.70158 * 0.8;
  return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2);
};

/** Split a continuous beat into the integer beat and the local progress inside it. */
export function splitBeat(beat: number): { index: number; local: number } {
  const b = clamp(beat, 0, BEAT_COUNT - 1e-6);
  const index = Math.floor(b);
  return { index, local: b - index };
}

/**
 * Continuous beat from the story blocks' positions: the block whose top has passed the viewport's reading line
 * is the current beat; how far the line is through that block is the local progress. Pure (tested).
 * `blocks` are [top, height] relative to the viewport; `line` is the reading line (e.g. 45 % of the height).
 */
export function beatFromBlocks(blocks: readonly (readonly [number, number])[], line: number): number {
  if (blocks.length === 0) return 0;
  let index = 0;
  for (let i = 0; i < blocks.length; i++) if ((blocks[i]?.[0] ?? Infinity) <= line) index = i;
  const [top, height] = blocks[index] ?? [0, 1];
  const local = height > 0 ? clamp((line - top) / height) : 0;
  return clamp(index + local, 0, blocks.length - 1e-6);
}

/** Transitions between beats happen in the second half of each beat, so a beat holds while its text is read. */
const transition = (local: number) => smoothstep(0.55, 1, local);

export interface CameraState {
  position: Vec3;
  target: Vec3;
}

export function cameraAt(beat: number): CameraState {
  const { index, local } = splitBeat(beat);
  const a = CAMERA[index] ?? CAMERA[0];
  const b = CAMERA[Math.min(index + 1, BEAT_COUNT - 1)] ?? a;
  const t = transition(local);
  return { position: lerp3(a.position, b.position, t), target: lerp3(a.target, b.target, t) };
}

export interface StoryState {
  /** 0 = hidden (the ring card stands in), 1 = the story card is out of the ring. */
  cardOut: number;
  cardPosition: Vec3;
  cardColor: "stone" | "promised" | "evergreen";
  /** 0..1 mix towards cardColor from stone. */
  cardColorMix: number;
  outline: number;
  check: number;
  ringOpacity: number;
  /** 0 = ring in its circle, 1 = cards stacked behind (beat 1). */
  ringStack: number;
  ringGreenWave: number;
  sheet: number;
  /** Beat 1: 0..1 progress of the lime scan line down the spreadsheet's rows. */
  scan: number;
  rail: number;
  activeTick: number;
  /** Beats 2–4: how far the lime progress runs along the rail, 0..1. */
  railFill: number;
  /** Beat 2: 0..1 drives the three channel tiles popping in one after another. */
  planTiles: number;
  /** Card lean: X tips the top away from the viewer (paper on a desk), Z leans it into its travel along the rail. */
  cardTilt: number;
  cardLean: number;
  /** Beat 3: the printed approval mark left on the card, and the ripple at the moment of contact. */
  mark: number;
  impact: number;
  stamp: { visible: number; press: number };
  person: number;
  clock: { visible: number; sweep: number; window: number };
  plane: { visible: number; along: number };
  bubble: { visible: number; along: number };
  seal: { visible: number; drop: number };
  receipt: number;
  stageMix: number;
}

/** All story values at a continuous beat. Pure; the scene damps towards these targets every frame. */
export function storyAt(beat: number): StoryState {
  const { index: i, local: l } = splitBeat(beat);
  const t = transition(l);
  const s: StoryState = {
    cardOut: 0,
    cardPosition: RING_FRONT,
    cardColor: "stone",
    cardColorMix: 0,
    outline: 0,
    check: 0,
    ringOpacity: 1,
    ringStack: 0,
    ringGreenWave: 0,
    sheet: 0,
    scan: 0,
    rail: 0,
    activeTick: 0,
    railFill: 0,
    planTiles: 0,
    cardTilt: 0,
    cardLean: 0,
    mark: 0,
    impact: 0,
    stamp: { visible: 0, press: 0 },
    person: 0,
    clock: { visible: 0, sweep: 0, window: 0 },
    plane: { visible: 0, along: 0 },
    bubble: { visible: 0, along: 0 },
    seal: { visible: 0, drop: 0 },
    receipt: 0,
    // Stage background: inverse (hero) → page bg as beat 0 → 1.
    stageMix: i === 0 ? t : 1,
  };
  const spot = (k: number): Vec3 => CARD_SPOT[Math.min(k, BEAT_COUNT - 1)] ?? RING_FRONT;
  s.cardPosition = lerp3(spot(i), spot(i + 1), t);

  switch (i) {
    case 0:
      s.cardOut = t;
      s.ringStack = t;
      // The other invoices clear the stage completely, so the one being imported has it to itself.
      s.ringOpacity = 1 - t;
      s.sheet = t;
      s.cardTilt = -0.4 * t;
      break;
    case 1: {
      s.cardOut = 1;
      s.ringStack = 1;
      s.ringOpacity = 0;
      s.sheet = 1 - t;
      // The rows are checked first (the preview), then the card rises off the sheet and stands up.
      s.scan = smoothstep(0, 0.42, l);
      const lift = smoothstep(0.3, 0.6, l);
      s.cardPosition = [s.cardPosition[0], s.cardPosition[1] + lift * 0.6, s.cardPosition[2]];
      s.cardTilt = -0.4 * (1 - lift);
      s.cardLean = Math.sin(Math.PI * t) * 0.14; // leans into its glide onto the rail
      s.rail = t;
      break;
    }
    case 2:
      s.cardOut = 1;
      s.ringOpacity = 0;
      s.ringStack = 1;
      s.rail = 1;
      s.activeTick = smoothstep(0.3, 0.6, l);
      s.railFill = lerp(stationFill(RAIL.stations[0]) * smoothstep(0.05, 0.5, l), stationFill(RAIL.stations[1]), t);
      s.planTiles = smoothstep(0.15, 0.6, l) * (1 - t);
      s.cardLean = -Math.sin(Math.PI * t) * 0.14;
      break;
    case 3:
      s.cardOut = 1;
      s.ringOpacity = 0;
      s.ringStack = 1;
      s.rail = 1;
      s.activeTick = 1;
      s.railFill = stationFill(RAIL.stations[1]);
      s.outline = smoothstep(0, 0.3, l);
      s.person = smoothstep(0, 0.25, l) * (1 - t);
      // The card tips back like paper on a desk; the stamp descends, presses at 40–70 %, then lifts and leaves a mark.
      s.cardTilt = -0.78 * smoothstep(0, 0.22, l) * (1 - smoothstep(0.8, 1, l));
      s.stamp = { visible: smoothstep(0, 0.2, l) * (1 - smoothstep(0.85, 1, l)), press: smoothstep(0.25, 0.45, l) * (1 - smoothstep(0.7, 0.85, l)) };
      s.mark = settle(smoothstep(0.44, 0.6, l));
      s.impact = smoothstep(0.42, 0.68, l);
      break;
    case 4:
      s.cardOut = 1;
      s.ringOpacity = 0;
      s.ringStack = 1;
      s.rail = 1 - t;
      s.activeTick = 1;
      s.railFill = lerp(stationFill(RAIL.stations[1]), stationFill(RAIL.stations[2]), smoothstep(0.4, 0.75, l));
      s.outline = 1 - smoothstep(0, 0.3, l);
      s.mark = 1 - t;
      s.clock = { visible: smoothstep(0, 0.15, l) * (1 - smoothstep(0.85, 1, l)), sweep: smoothstep(0, 0.4, l), window: smoothstep(0.3, 0.42, l) };
      s.plane = { visible: l >= 0.4 && l < 1 ? 1 : 0, along: smoothstep(0.4, 1, l) };
      break;
    case 5: {
      s.cardOut = 1;
      s.ringOpacity = 0;
      s.ringStack = 1;
      const arrive = smoothstep(0, 0.6, l);
      s.bubble = { visible: 1, along: 1 - arrive };
      s.cardColor = "promised";
      s.cardColorMix = smoothstep(0.5, 0.7, l);
      break;
    }
    case 6:
      s.cardOut = 1;
      s.ringOpacity = 0;
      s.ringStack = 1;
      s.cardColor = "promised";
      s.cardColorMix = 1 - smoothstep(0, 0.3, l);
      s.bubble = { visible: 1 - smoothstep(0, 0.3, l), along: 0 };
      s.seal = { visible: smoothstep(0.1, 0.25, l), drop: settle(smoothstep(0.2, 0.55, l)) };
      break;
    case 7: {
      const back = smoothstep(0.55, 0.95, l);
      s.cardOut = 1 - back;
      s.cardPosition = lerp3([0, 0, 0], RING_FRONT, back);
      s.cardColor = "evergreen";
      s.cardColorMix = smoothstep(0, 0.2, l);
      s.check = settle(smoothstep(0.1, 0.3, l));
      s.receipt = smoothstep(0.15, 0.4, l) * (1 - smoothstep(0.5, 0.65, l));
      s.seal = { visible: 1 - smoothstep(0, 0.15, l), drop: 1 };
      s.ringOpacity = smoothstep(0.4, 0.8, l);
      s.ringStack = 1 - smoothstep(0.4, 0.8, l);
      s.ringGreenWave = smoothstep(0.75, 1, l);
      break;
    }
  }
  return s;
}

/** Ring rotation (radians) at time t: one revolution per minute (duration-ambient). */
export function ringAngle(timeMs: number): number {
  return ((timeMs % RING.periodMs) / RING.periodMs) * Math.PI * 2;
}

/**
 * Card i's colour state on the turning ring: approaching the front it warms; passing the front (the "paid point")
 * it turns evergreen and its check pops; it stays paid round the side and resets out of sight at the back.
 * `wave` (beat 7) turns every card green with a 40 ms stagger over duration-scene (900 ms).
 */
export function ringCardState(i: number, count: number, angle: number, wave = 0): { green: number; warm: number; check: number } {
  const a = angle + (i / count) * Math.PI * 2;
  const phase = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); // 0 = front
  const paid = phase < Math.PI ? smoothstep(0, 0.25, phase) : 0;
  const warm = phase > Math.PI ? smoothstep(2 * Math.PI - 0.9, 2 * Math.PI - 0.1, phase) : 0;
  const staggered = clamp((wave * 900 - i * 40) / 400);
  const green = Math.max(paid, staggered);
  return { green, warm: warm * (1 - green), check: Math.max(phase < Math.PI ? settle(smoothstep(0.05, 0.3, phase)) : 0, settle(staggered)) };
}

/** Position of card i on the ring (in the ring's own, untilted frame). */
export function ringCardPosition(i: number, count: number, angle: number): Vec3 {
  const a = angle + (i / count) * Math.PI * 2;
  return [Math.sin(a) * RING.radius, 0, Math.cos(a) * RING.radius];
}

/**
 * Exponential damping (§6.2.2): x += (target − x)·(1 − e^(−delta·λ)). The spec gives λ = 6 and also says "settles in
 * about 120 ms"; those disagree (λ = 6 reaches 95 % after ~0.5 s). λ = 6 is the default; the scene uses 25 for the
 * ~120 ms settle where a quick response matters (CONFLICTS C-28).
 */
export function damp(current: number, target: number, deltaSeconds: number, lambda = 6): number {
  return current + (target - current) * (1 - Math.exp(-deltaSeconds * lambda));
}
