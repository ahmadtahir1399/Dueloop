"use client";

// The Loop (redesign §6.2): one ring of instanced invoice cards plus one story card and its props. Every value is
// computed from (beat, ambient time) by keyframes.ts and damped toward it each frame; nothing re-renders React per
// frame. Geometry is procedural (no model files, no drei, no post-processing). Colours come from keyframes.COLORS.
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import {
  BoxGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  ConeGeometry,
  CurvePath,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  BufferGeometry,
  LatheGeometry,
  LineCurve3,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  RingGeometry,
  Shape,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from "three";
import type { Group, InstancedMesh, Mesh } from "three";
import {
  CARD,
  COLORS,
  RAIL,
  RING,
  RING_FRONT,
  cameraAt,
  clamp,
  damp,
  ringAngle,
  ringCardPosition,
  ringCardState,
  settle,
  smoothstep,
  storyAt,
  type Vec3,
} from "./keyframes";
import { watchdogStep, type Tier } from "./tier";

export interface LoopSceneProps {
  beatRef: MutableRefObject<number>;
  tier: Exclude<Tier, 0>;
  paused: boolean;
  /** Stills (§6.2.6): a fixed beat, ambient time fixed at 0, values snapped (no damping). */
  frozen?: { beat: number } | null;
  onFirstFrame?: () => void;
  onTierDrop?: () => void;
}

function roundedRect(w: number, h: number, r: number): Shape {
  const s = new Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function checkStroke(size: number): TubeGeometry {
  const path = new CurvePath<Vector3>();
  path.add(new LineCurve3(new Vector3(-0.45 * size, 0, 0), new Vector3(-0.1 * size, -0.35 * size, 0)));
  path.add(new LineCurve3(new Vector3(-0.1 * size, -0.35 * size, 0), new Vector3(0.5 * size, 0.35 * size, 0)));
  return new TubeGeometry(path, 8, 0.12 * size, 6, false);
}

/** Folded paper dart, nose along +Z: two wings with a slight dihedral, and the keel fold beneath them. */
function paperPlaneWings(): BufferGeometry {
  const g = new BufferGeometry();
  const p = [0, 0, 0.62, -0.44, 0.08, -0.42, 0, 0, -0.2, 0, 0, 0.62, 0, 0, -0.2, 0.44, 0.08, -0.42];
  g.setAttribute("position", new Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  return g;
}
function paperPlaneKeel(): BufferGeometry {
  const g = new BufferGeometry();
  const p = [0, 0, 0.62, 0, 0, -0.2, 0, -0.17, -0.3];
  g.setAttribute("position", new Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  return g;
}

/** A solid of revolution from [radius, height] points; axis along +Y. */
const lathe = (points: readonly (readonly [number, number])[], segments = 28) =>
  new LatheGeometry(points.map(([r, y]) => new Vector2(r, y)), segments);

function blobTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d");
  if (ctx) {
    const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, "rgba(10,35,24,0.35)");
    grad.addColorStop(1, "rgba(10,35,24,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);
  }
  return new CanvasTexture(c);
}

/** Bars on a card face (3 "text" bars and an amount bar): [x, y, width, height] in card units. */
const BARS: readonly [number, number, number, number][] = [
  [-0.12, 0.42, 0.58, 0.055],
  [-0.17, 0.3, 0.48, 0.055],
  [-0.07, 0.18, 0.68, 0.055],
  [-0.24, -0.44, 0.34, 0.1],
];

/** The spreadsheet in beat 1 (sheet units): one row per invoice, three cells and a check at the end of the row. */
const SHEET = { rows: [0.42, 0.18, -0.06, -0.3, -0.54], cols: [-0.92, -0.32, 0.28], cellW: 0.46, cellH: 0.075, checkX: 1.02 } as const;
const SHEET_INSTANCES = SHEET.rows.length * SHEET.cols.length;
const CLOCK_MARKS = 12;
const TRAIL_DOTS = 16;

const C = {
  stone: new Color(COLORS.stone),
  warm: new Color(COLORS.warm),
  green: new Color(COLORS.evergreen),
  barStone: new Color(COLORS.barStone),
  barGreen: new Color(COLORS.barGreen),
  promised: new Color(COLORS.promised),
};

export function LoopScene({ beatRef, tier, paused, frozen, onFirstFrame, onTierDrop }: LoopSceneProps) {
  const count = tier === 2 ? RING.cardsFull : RING.cardsLite;
  const { camera, gl, invalidate } = useThree();

  // ---- geometry and materials (created once) ----
  const geo = useMemo(() => {
    const card = new ExtrudeGeometry(roundedRect(CARD.width, CARD.height, CARD.radius), { depth: CARD.depth, bevelEnabled: false, curveSegments: 4 });
    const frameShape = roundedRect(CARD.width + 0.1, CARD.height + 0.1, CARD.radius + 0.05);
    frameShape.holes.push(roundedRect(CARD.width + 0.03, CARD.height + 0.03, CARD.radius + 0.015));
    const frame = new ExtrudeGeometry(frameShape, { depth: 0.01, bevelEnabled: false, curveSegments: 4 });
    const bar = new BoxGeometry(1, 1, 0.006);
    const disc = new CylinderGeometry(0.14, 0.14, 0.02, 24);
    disc.rotateX(Math.PI / 2);
    const check = checkStroke(0.16);
    const sheet = new ExtrudeGeometry(roundedRect(2.6, 1.7, 0.09), { depth: 0.03, bevelEnabled: false, curveSegments: 6 });
    const railBar = new CylinderGeometry(0.02, 0.02, RAIL.length, 12);
    railBar.rotateZ(Math.PI / 2);
    const railFill = new CylinderGeometry(0.03, 0.03, 1, 12);
    railFill.rotateZ(Math.PI / 2);
    railFill.translate(0.5, 0, 0); // grows rightwards from its left end
    const node = new CylinderGeometry(0.075, 0.075, 0.05, 28);
    node.rotateX(Math.PI / 2);
    const bead = new SphereGeometry(0.06, 16, 12);
    const tile = new ExtrudeGeometry(roundedRect(0.46, 0.36, 0.08), { depth: 0.03, bevelEnabled: false, curveSegments: 5 });
    // Rubber stamp turned on a lathe, axis along +Z so it presses into the card's face.
    const stampBody = lathe([[0, 0.035], [0.25, 0.035], [0.25, 0.1], [0.2, 0.125], [0.085, 0.17], [0.058, 0.25], [0.062, 0.34], [0.105, 0.4], [0.118, 0.46], [0.09, 0.515], [0, 0.535]]);
    stampBody.rotateX(Math.PI / 2);
    const stampPad = new CylinderGeometry(0.235, 0.235, 0.035, 36);
    stampPad.rotateX(Math.PI / 2);
    stampPad.translate(0, 0, 0.0175);
    const markRing = new TorusGeometry(0.2, 0.016, 8, 48);
    const ripple = new TorusGeometry(0.27, 0.012, 8, 48);
    const head = new SphereGeometry(0.165, 24, 18);
    const torso = lathe([[0, 0], [0.32, 0], [0.335, 0.05], [0.3, 0.17], [0.2, 0.29], [0.1, 0.355], [0, 0.375]], 32);
    const clockFace = new CylinderGeometry(0.47, 0.47, 0.03, 56);
    clockFace.rotateX(Math.PI / 2);
    const clockRing = new TorusGeometry(0.47, 0.042, 14, 72);
    const clockHour = new BoxGeometry(0.04, 0.24, 0.016);
    clockHour.translate(0, 0.1, 0);
    const clockMinute = new BoxGeometry(0.026, 0.36, 0.016);
    clockMinute.translate(0, 0.15, 0);
    const clockCap = new CylinderGeometry(0.042, 0.042, 0.03, 20);
    clockCap.rotateX(Math.PI / 2);
    // The allowed sending window on the dial: 9 to 11 o'clock (angles run anticlockwise from 3 o'clock).
    const clockWindow = new RingGeometry(0.21, 0.385, 32, 1, (120 * Math.PI) / 180, (60 * Math.PI) / 180);
    const planeWings = paperPlaneWings();
    const planeKeel = paperPlaneKeel();
    const dot = new SphereGeometry(0.018, 8, 6);
    const bubble = new ExtrudeGeometry(roundedRect(0.9, 0.62, 0.14), { depth: 0.04, bevelEnabled: false, curveSegments: 4 });
    const tail = new ConeGeometry(0.1, 0.22, 4);
    const calendar = new BoxGeometry(0.36, 0.3, 0.02);
    const seal = new CylinderGeometry(0.32, 0.32, 0.06, 40);
    seal.rotateX(Math.PI / 2);
    const sealCheck = checkStroke(0.3);
    const receipt = new PlaneGeometry(0.7, 1.0);
    const blob = new PlaneGeometry(1.4, 1.4);
    return { card, frame, bar, disc, check, sheet, railBar, railFill, node, bead, tile, stampBody, stampPad, markRing, ripple, head, torso, clockFace, clockRing, clockHour, clockMinute, clockCap, clockWindow, planeWings, planeKeel, dot, bubble, tail, calendar, seal, sealCheck, receipt, blob };
  }, []);

  const mat = useMemo(() => {
    const blobMap = typeof document === "undefined" ? null : blobTexture();
    return {
      ring: new MeshStandardMaterial({ color: "#ffffff", roughness: 0.55, metalness: 0, transparent: true }),
      ringBars: new MeshStandardMaterial({ color: "#ffffff", roughness: 0.55, metalness: 0, transparent: true }),
      // lime / ink fade with the ring; the *Solid pair is for the story props, which have their own timing.
      lime: new MeshStandardMaterial({ color: COLORS.lime, roughness: 0.5, metalness: 0, transparent: true }),
      ink: new MeshStandardMaterial({ color: COLORS.ink, roughness: 0.6, metalness: 0, transparent: true }),
      limeSolid: new MeshStandardMaterial({ color: COLORS.lime, emissive: COLORS.lime, emissiveIntensity: 0.3, roughness: 0.45, metalness: 0 }),
      inkSolid: new MeshStandardMaterial({ color: COLORS.ink, roughness: 0.5, metalness: 0 }),
      limeFade: new MeshStandardMaterial({ color: COLORS.lime, emissive: COLORS.lime, emissiveIntensity: 0.3, roughness: 0.45, metalness: 0, transparent: true }),
      dialWindow: new MeshStandardMaterial({ color: COLORS.evergreen, roughness: 0.6, metalness: 0, transparent: true }),
      ripple: new MeshBasicMaterial({ color: COLORS.lime, transparent: true, depthWrite: false }),
      story: new MeshStandardMaterial({ color: COLORS.stone, roughness: 0.55, metalness: 0 }),
      storyBar: new MeshStandardMaterial({ color: COLORS.barStone, roughness: 0.55, metalness: 0 }),
      prop: new MeshStandardMaterial({ color: COLORS.prop, roughness: 0.46, metalness: 0 }),
      markInk: new MeshStandardMaterial({ color: COLORS.prop, roughness: 0.7, metalness: 0 }),
      wing: new MeshStandardMaterial({ color: COLORS.evergreen, roughness: 0.5, metalness: 0, side: DoubleSide }),
      keel: new MeshStandardMaterial({ color: COLORS.prop, roughness: 0.5, metalness: 0, side: DoubleSide }),
      dial: new MeshStandardMaterial({ color: COLORS.paper, roughness: 0.5, metalness: 0 }),
      tile: new MeshStandardMaterial({ color: COLORS.prop, roughness: 0.42, metalness: 0 }),
      tileGlyph: new MeshStandardMaterial({ color: COLORS.paper, roughness: 0.6, metalness: 0 }),
      sheetCell: new MeshStandardMaterial({ color: "#ffffff", roughness: 0.7, metalness: 0, transparent: true }),
      sheetHead: new MeshStandardMaterial({ color: COLORS.prop, roughness: 0.6, metalness: 0, transparent: true }),
      rail: new MeshStandardMaterial({ color: COLORS.rail, roughness: 0.55, metalness: 0, transparent: true }),
      paper: new MeshStandardMaterial({ color: COLORS.paper, roughness: 0.6, metalness: 0, transparent: true, side: DoubleSide }),
      sheet: new MeshStandardMaterial({ color: COLORS.stone, roughness: 0.7, metalness: 0, transparent: true }),
      promised: new MeshStandardMaterial({ color: COLORS.promised, roughness: 0.55, metalness: 0, transparent: true }),
      blob: new MeshBasicMaterial({ map: blobMap, transparent: true, depthWrite: false }),
    };
  }, []);

  useEffect(
    () => () => {
      Object.values(geo).forEach((g) => g.dispose());
      Object.values(mat).forEach((m) => {
        if ("map" in m && m.map) m.map.dispose();
        m.dispose();
      });
    },
    [geo, mat],
  );

  // ---- scene refs ----
  const ringGroup = useRef<Group>(null);
  const cards = useRef<InstancedMesh>(null);
  const bars = useRef<InstancedMesh>(null);
  const discs = useRef<InstancedMesh>(null);
  const checks = useRef<InstancedMesh>(null);
  const story = useRef<Group>(null);
  const storyCard = useRef<Mesh>(null);
  const pivot = useRef<Group>(null);
  const outline = useRef<Mesh>(null);
  const storyCheck = useRef<Group>(null);
  const sheet = useRef<Group>(null);
  const sheetCells = useRef<InstancedMesh>(null);
  const sheetChecks = useRef<InstancedMesh>(null);
  const scanLine = useRef<Mesh>(null);
  const rail = useRef<Group>(null);
  const railFill = useRef<Mesh>(null);
  const railBead = useRef<Mesh>(null);
  const nodes = useRef<(Mesh | null)[]>([]);
  const tiles = useRef<(Group | null)[]>([]);
  const stamp = useRef<Group>(null);
  const mark = useRef<Group>(null);
  const ripple = useRef<Mesh>(null);
  const person = useRef<Group>(null);
  const personTick = useRef<Group>(null);
  const clock = useRef<Group>(null);
  const clockMarks = useRef<InstancedMesh>(null);
  const clockWindow = useRef<Mesh>(null);
  const clockHour = useRef<Mesh>(null);
  const clockMinute = useRef<Mesh>(null);
  const plane = useRef<Group>(null);
  const trail = useRef<InstancedMesh>(null);
  const bubble = useRef<Group>(null);
  const seal = useRef<Group>(null);
  const receipt = useRef<Mesh>(null);

  // ---- animated state (damped) and interaction ----
  const live = useRef({
    ambientMs: 0,
    spin: 0,
    spinVelocity: 0,
    tiltX: 0,
    tiltY: 0,
    hovered: -1,
    lift: new Float32Array(RING.cardsFull),
    cam: new Vector3(0, 1.2, 9),
    target: new Vector3(0, 0, 0),
    storyPos: new Vector3(...RING_FRONT),
    tilt: 0,
    lean: 0,
    story: storyAt(0),
    first: true,
    sheetReady: false,
    watchdog: { elapsed: 0, frames: 0 },
  });

  const arc = useMemo(() => new CatmullRomCurve3([new Vector3(0.3, 0.3, 0.2), new Vector3(1.6, 1.4, 0.4), new Vector3(3.2, 1.6, -0.6), new Vector3(5.5, 2.4, -1.5)]), []);

  // Drag to spin (Tier 2, mouse only, beat 0): never captures touch, so page scrolling is never blocked.
  useEffect(() => {
    if (tier !== 2 || frozen) return;
    const el = gl.domElement;
    let down = false;
    let lastX = 0;
    let lastT = 0;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || beatRef.current > 0.5) return;
      down = true;
      lastX = e.clientX;
      lastT = performance.now();
    };
    const onMove = (e: PointerEvent) => {
      if (!down) return;
      const now = performance.now();
      const dx = e.clientX - lastX;
      live.current.spin += dx * 0.006;
      live.current.spinVelocity = (dx * 0.006) / Math.max(1, now - lastT);
      lastX = e.clientX;
      lastT = now;
      invalidate();
    };
    const onUp = () => {
      down = false;
    };
    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [gl, tier, frozen, beatRef, invalidate]);

  const dummy = useMemo(() => new Object3D(), []);
  const m4 = useMemo(() => new Matrix4(), []);
  const tmpColor = useMemo(() => new Color(), []);
  const tmpA = useMemo(() => new Vector3(), []);
  const tmpB = useMemo(() => new Vector3(), []);

  // The clock's hour marks never move, so they are placed once.
  useEffect(() => {
    const im = clockMarks.current;
    if (!im) return;
    for (let i = 0; i < CLOCK_MARKS; i++) {
      const major = i % 3 === 0;
      const a = (i / CLOCK_MARKS) * Math.PI * 2;
      dummy.position.set(Math.sin(a) * 0.395, Math.cos(a) * 0.395, 0.019);
      dummy.rotation.set(0, 0, -a);
      dummy.scale.set(major ? 0.024 : 0.012, major ? 0.075 : 0.045, 1);
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
    }
    im.instanceMatrix.needsUpdate = true;
  }, [dummy]);

  useFrame((state, delta) => {
    const L = live.current;
    // Frame counter for the D17 check (development only; stripped from production by the bundler).
    if (process.env.NODE_ENV !== "production") (window as Window & { __loopFrames?: number }).__loopFrames = ((window as Window & { __loopFrames?: number }).__loopFrames ?? 0) + 1;
    const snap = paused || !!frozen;
    const dt = Math.min(delta, 0.1);
    const k = (lambda: number) => (snap ? 1 : 1 - Math.exp(-dt * lambda));

    // Watchdog (§6.2.3): drop a tier when the rolling 3 s average is below the floor.
    if (!snap && onTierDrop) {
      const w = watchdogStep(L.watchdog, delta * 1000, tier);
      L.watchdog = w.state;
      if (w.drop) onTierDrop();
    }

    const beat = frozen ? frozen.beat : beatRef.current;
    if (!snap) L.ambientMs += dt * 1000;
    if (!snap && Math.abs(L.spinVelocity) > 1e-6) {
      // Inertia after a drag decays back to ambient over about 1.5 s.
      L.spin += L.spinVelocity * dt * 1000;
      L.spinVelocity *= Math.exp(-dt * 3);
    }
    const ambient = frozen ? 0 : L.ambientMs;
    const angle = ringAngle(ambient) + L.spin;

    // Story targets.
    const s = storyAt(beat);
    L.story = s;

    // Camera.
    const cam = cameraAt(beat);
    L.cam.lerp(new Vector3(...cam.position), k(25));
    L.target.lerp(new Vector3(...cam.target), k(25));
    // Narrow or square stages (phones, stills) move the camera back along its view line so the ring fits; the
    // spec keyframes are tuned for a wide stage. Factor 1 at aspect >= 1.6, up to 1.7 when tall.
    const aspect = state.size.width / Math.max(1, state.size.height);
    const fit = Math.min(1.7, Math.max(1, 1.6 / aspect));
    camera.position.copy(L.target).add(new Vector3().subVectors(L.cam, L.target).multiplyScalar(fit));
    camera.lookAt(L.target);

    // Pointer parallax ±4° (Tier 2, hero only).
    const heroInteractive = tier === 2 && beat < 0.5 && !frozen;
    const px = heroInteractive ? state.pointer.y * ((4 * Math.PI) / 180) : 0;
    const py = heroInteractive ? state.pointer.x * ((4 * Math.PI) / 180) : 0;
    L.tiltX = snap ? px : damp(L.tiltX, px, dt, 25);
    L.tiltY = snap ? py : damp(L.tiltY, py, dt, 25);

    // ---- Ring ----
    const ring = ringGroup.current;
    if (ring) {
      ring.rotation.set(RING.tiltX + L.tiltX, L.tiltY, 0);
      mat.ring.opacity = s.ringOpacity;
      mat.ringBars.opacity = s.ringOpacity;
      mat.lime.opacity = s.ringOpacity;
      mat.ink.opacity = s.ringOpacity;
      ring.visible = s.ringOpacity > 0.01;
    }
    const cm = cards.current;
    const bm = bars.current;
    const dm = discs.current;
    const km = checks.current;
    if (cm && bm && dm && km) {
      for (let i = 0; i < count; i++) {
        const [x, , z] = ringCardPosition(i, count, angle);
        const a = Math.atan2(x, z);
        const isFront = Math.cos(a) > 0.97;
        const hideForStory = isFront && s.cardOut > 0.02;
        // Stack (beat 1): cards fly back into a neat pile behind and to the right.
        const sx = 2.4 + i * 0.015;
        const sy = -0.3 + i * 0.035;
        const sz = -2.2 - i * 0.01;
        const t = s.ringStack;
        const lift = (L.lift[i] = snap ? (L.hovered === i ? 0.15 : 0) : damp(L.lift[i] ?? 0, L.hovered === i && heroInteractive ? 0.15 : 0, dt, 25));
        dummy.position.set(x + (sx - x) * t, lift + (sy - 0) * t, z + (sz - z) * t);
        dummy.rotation.set(0, a * (1 - t) + (L.hovered === i ? ((8 * Math.PI) / 180) * Math.sign(-x || 1) * (lift / 0.15) : 0), 0);
        const scale = hideForStory ? 0.0001 : 1;
        dummy.scale.set(scale, scale, scale);
        dummy.updateMatrix();
        cm.setMatrixAt(i, dummy.matrix);
        const st = ringCardState(i, count, angle, s.ringGreenWave);
        tmpColor.copy(C.stone).lerp(C.warm, st.warm).lerp(C.green, st.green);
        cm.setColorAt(i, tmpColor);
        for (let b = 0; b < BARS.length; b++) {
          const bar = BARS[b];
          if (!bar) continue;
          const [bx, by, bw, bh] = bar;
          m4.makeTranslation(bx, by, CARD.depth + 0.004).multiply(new Matrix4().makeScale(bw, bh, 1));
          bm.setMatrixAt(i * BARS.length + b, new Matrix4().copy(dummy.matrix).multiply(m4));
          tmpColor.copy(C.barStone).lerp(C.barGreen, st.green);
          bm.setColorAt(i * BARS.length + b, tmpColor);
        }
        const cs = Math.max(0.0001, st.check * scale);
        m4.makeTranslation(0.34, -0.5, CARD.depth + 0.012).multiply(new Matrix4().makeScale(cs, cs, cs));
        dm.setMatrixAt(i, new Matrix4().copy(dummy.matrix).multiply(m4));
        m4.makeTranslation(0.34, -0.5, CARD.depth + 0.03).multiply(new Matrix4().makeScale(cs, cs, cs));
        km.setMatrixAt(i, new Matrix4().copy(dummy.matrix).multiply(m4));
      }
      for (const im of [cm, bm, dm, km]) {
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
      }
    }

    // ---- Story card ----
    const sg = story.current;
    if (sg) {
      sg.visible = s.cardOut > 0.02;
      L.storyPos.lerp(new Vector3(...(s.cardPosition as Vec3)), k(25));
      sg.position.copy(L.storyPos);
      // Out of the ring the card faces the camera; in the ring it shares the ring's tilt.
      sg.rotation.set(RING.tiltX * (1 - s.cardOut), 0, 0);
      const face = tmpColor.copy(C.stone).lerp(s.cardColor === "promised" ? C.promised : s.cardColor === "evergreen" ? C.green : C.stone, s.cardColorMix);
      mat.story.color.copy(face);
      mat.storyBar.color.copy(C.barStone).lerp(C.barGreen, s.cardColor === "evergreen" ? s.cardColorMix : 0);
    }
    L.tilt = snap ? s.cardTilt : damp(L.tilt, s.cardTilt, dt, 25);
    L.lean = snap ? s.cardLean : damp(L.lean, s.cardLean, dt, 25);
    if (pivot.current) pivot.current.rotation.set(L.tilt, 0, L.lean);
    if (outline.current) outline.current.scale.setScalar(Math.max(0.0001, s.outline));
    if (storyCheck.current) storyCheck.current.scale.setScalar(Math.max(0.0001, s.check));
    if (mark.current) mark.current.scale.setScalar(Math.max(0.0001, s.mark));
    if (ripple.current) {
      ripple.current.visible = s.impact > 0.001 && s.impact < 0.999;
      ripple.current.scale.setScalar(1 + s.impact * 1.3);
      mat.ripple.opacity = 1 - s.impact;
    }
    mat.blob.opacity = 1 - s.sheet;

    // ---- Props ----
    mat.limeFade.opacity = Math.max(s.sheet, s.rail);
    if (sheet.current) {
      sheet.current.visible = s.sheet > 0.01;
      mat.sheet.opacity = s.sheet;
      mat.sheetCell.opacity = s.sheet;
      mat.sheetHead.opacity = s.sheet;
    }
    const cellsMesh = sheetCells.current;
    const checksMesh = sheetChecks.current;
    if (cellsMesh && checksMesh && (s.sheet > 0.01 || !L.sheetReady)) {
      L.sheetReady = true;
      const rowsDone = s.scan * SHEET.rows.length;
      SHEET.rows.forEach((y, r) => {
        const done = clamp(rowsDone - r);
        SHEET.cols.forEach((x, c) => {
          dummy.position.set(x, y, 0.036);
          dummy.rotation.set(0, 0, 0);
          // Row lengths vary a little so it reads as data, not as a grid of identical bars.
          dummy.scale.set(SHEET.cellW * (0.72 + 0.28 * Math.abs(Math.sin(r * 2.3 + c * 1.7))), SHEET.cellH, 1);
          dummy.updateMatrix();
          const i = r * SHEET.cols.length + c;
          cellsMesh.setMatrixAt(i, dummy.matrix);
          cellsMesh.setColorAt(i, tmpColor.copy(C.barStone).lerp(C.green, done));
        });
        dummy.position.set(SHEET.checkX, y, 0.042);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(Math.max(0.0001, settle(done) * 0.62));
        dummy.updateMatrix();
        checksMesh.setMatrixAt(r, dummy.matrix);
      });
      cellsMesh.instanceMatrix.needsUpdate = true;
      if (cellsMesh.instanceColor) cellsMesh.instanceColor.needsUpdate = true;
      checksMesh.instanceMatrix.needsUpdate = true;
    }
    if (scanLine.current) {
      scanLine.current.visible = s.scan > 0.001 && s.scan < 0.999;
      const first = SHEET.rows[0] + 0.12;
      const last = SHEET.rows[4] - 0.12;
      scanLine.current.position.y = first + (last - first) * s.scan;
    }
    if (rail.current) {
      rail.current.visible = s.rail > 0.01;
      mat.rail.opacity = s.rail;
    }
    if (railFill.current) {
      railFill.current.visible = s.railFill > 0.001;
      railFill.current.scale.x = Math.max(0.0001, s.railFill * RAIL.length);
    }
    if (railBead.current) {
      railBead.current.visible = s.railFill > 0.001;
      railBead.current.position.x = -RAIL.length / 2 + s.railFill * RAIL.length;
    }
    RAIL.stations.forEach((x, i) => {
      const node = nodes.current[i];
      if (node) node.material = s.railFill * RAIL.length - RAIL.length / 2 >= x - 0.02 ? mat.limeFade : mat.rail;
      const tile = tiles.current[i];
      if (tile) {
        const pop = settle(clamp(s.planTiles * 3 - i));
        tile.visible = pop > 0.01;
        tile.scale.setScalar(Math.max(0.0001, pop));
      }
    });
    if (stamp.current) {
      stamp.current.visible = s.stamp.visible > 0.01;
      // Comes in over the card, then presses along the card's own axis onto its face (the card is tipped back).
      stamp.current.position.set(0.1, -0.2 + (1 - s.stamp.visible) * 0.9, CARD.depth / 2 + (1 - s.stamp.press) * 0.72);
    }
    if (person.current) {
      person.current.visible = s.person > 0.01;
      person.current.scale.setScalar(Math.max(0.0001, s.person));
    }
    if (personTick.current) personTick.current.scale.setScalar(Math.max(0.0001, s.mark));
    if (clock.current) {
      clock.current.visible = s.clock.visible > 0.01;
      // A small bump as the hands land on the allowed time.
      clock.current.scale.setScalar(Math.max(0.0001, s.clock.visible * (1 + 0.05 * Math.sin(Math.PI * s.clock.window))));
      // Quiet hours run out: the hour hand travels 6 to 9 o'clock while the minute hand goes round three times.
      if (clockHour.current) clockHour.current.rotation.z = -(Math.PI + (s.clock.sweep * Math.PI) / 2);
      if (clockMinute.current) clockMinute.current.rotation.z = -s.clock.sweep * Math.PI * 6;
      mat.dialWindow.opacity = s.clock.window * 0.6;
      if (clockWindow.current) clockWindow.current.visible = s.clock.window > 0.01;
    }
    if (plane.current) {
      plane.current.visible = s.plane.visible > 0;
      const along = clamp(s.plane.along);
      arc.getPointAt(along, tmpA);
      arc.getPointAt(clamp(along + 0.02), tmpB);
      plane.current.position.copy(tmpA);
      plane.current.lookAt(tmpB);
      plane.current.rotateZ(Math.sin(Math.PI * along) * 0.65); // banks into the turn
      plane.current.scale.setScalar(Math.max(0.0001, smoothstep(0, 0.08, along) * 0.85));
    }
    const trailMesh = trail.current;
    if (trailMesh) {
      const along = s.plane.visible > 0 ? clamp(s.plane.along) : 0;
      trailMesh.visible = along > 0;
      if (along > 0) {
        for (let i = 0; i < TRAIL_DOTS; i++) {
          const u = 0.08 + (0.92 * (i + 0.5)) / TRAIL_DOTS; // starts clear of the card
          arc.getPointAt(u, tmpA);
          dummy.position.copy(tmpA);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.setScalar(Math.max(0.0001, clamp((along - u) / 0.06)));
          dummy.updateMatrix();
          trailMesh.setMatrixAt(i, dummy.matrix);
        }
        trailMesh.instanceMatrix.needsUpdate = true;
      }
    }
    if (bubble.current) {
      bubble.current.visible = s.bubble.visible > 0.01;
      const along = clamp(s.bubble.along * 0.85);
      const p = arc.getPointAt(along);
      bubble.current.position.set(p.x + 0.55, p.y + 0.1, p.z);
      bubble.current.scale.setScalar(Math.max(0.0001, s.bubble.visible));
    }
    if (seal.current) {
      seal.current.visible = s.seal.visible > 0.01;
      seal.current.position.y = 1.8 - s.seal.drop * 1.75;
      seal.current.scale.setScalar(Math.max(0.0001, s.seal.visible));
    }
    if (receipt.current) {
      receipt.current.visible = s.receipt > 0.01;
      receipt.current.position.set(0.25 + s.receipt * 0.75, 0.05, -0.02);
    }

    if (L.first) {
      L.first = false;
      onFirstFrame?.();
    }
  });

  return (
    <>
      <ambientLight intensity={0.6 * Math.PI} />
      <directionalLight position={[3, 5, 4]} intensity={0.9 * Math.PI} />
      {tier === 2 ? <pointLight position={[-4, 2, -3]} intensity={0.25 * Math.PI * 12} color={COLORS.lime} /> : null}

      <group ref={ringGroup}>
        <instancedMesh
          ref={cards}
          args={[geo.card, mat.ring, count]}
          onPointerMove={(e) => {
            if (tier === 2 && typeof e.instanceId === "number") live.current.hovered = e.instanceId;
          }}
          onPointerOut={() => {
            live.current.hovered = -1;
          }}
        />
        <instancedMesh ref={bars} args={[geo.bar, mat.ringBars, count * BARS.length]} />
        <instancedMesh ref={discs} args={[geo.disc, mat.lime, count]} />
        <instancedMesh ref={checks} args={[geo.check, mat.ink, count]} />
      </group>

      <group ref={story}>
        <group ref={pivot}>
          <mesh ref={storyCard} geometry={geo.card} material={mat.story} position={[0, 0, -CARD.depth / 2]} />
          {BARS.map(([x, y, w, h], i) => (
            <mesh key={i} geometry={geo.bar} material={mat.storyBar} position={[x, y, CARD.depth / 2 + 0.004]} scale={[w, h, 1]} />
          ))}
          <mesh ref={outline} geometry={geo.frame} material={mat.limeSolid} position={[0, 0, -0.005]} />
          <group ref={storyCheck} position={[0.34, -0.5, CARD.depth / 2 + 0.02]}>
            <mesh geometry={geo.disc} material={mat.limeSolid} scale={1.4} />
            <mesh geometry={geo.check} material={mat.inkSolid} position={[0, 0, 0.02]} scale={1.4} />
          </group>
          {/* The approval the stamp leaves behind, printed in ink on the card. */}
          <group ref={mark} position={[0.1, -0.2, CARD.depth / 2 + 0.008]}>
            <mesh geometry={geo.markRing} material={mat.markInk} />
            <mesh geometry={geo.sealCheck} material={mat.markInk} scale={0.62} />
          </group>
          <mesh ref={ripple} geometry={geo.ripple} material={mat.ripple} position={[0.1, -0.2, CARD.depth / 2 + 0.012]} />
          <group ref={stamp}>
            <mesh geometry={geo.stampBody} material={mat.prop} />
            <mesh geometry={geo.stampPad} material={mat.limeSolid} />
          </group>
          <mesh ref={receipt} geometry={geo.receipt} material={mat.paper} />
        </group>
        <mesh geometry={geo.blob} material={mat.blob} position={[0, -0.74, -0.1]} rotation={[-Math.PI / 2, 0, 0]} />
      </group>

      <group ref={sheet} position={[-0.4, -0.92, -0.45]} rotation={[-0.95, 0, 0]}>
        <mesh geometry={geo.sheet} material={mat.sheet} />
        <mesh geometry={geo.bar} material={mat.sheetHead} position={[0, 0.7, 0.036]} scale={[2.42, 0.13, 1]} />
        <instancedMesh ref={sheetCells} args={[geo.bar, mat.sheetCell, SHEET_INSTANCES]} />
        <instancedMesh ref={sheetChecks} args={[geo.disc, mat.sheetHead, SHEET.rows.length]} />
        <mesh ref={scanLine} geometry={geo.bar} material={mat.sheetHead} position={[0, 0, 0.05]} scale={[2.46, 0.03, 1]} />
      </group>

      <group ref={rail} position={[0, -0.95, 0]}>
        <mesh geometry={geo.railBar} material={mat.rail} />
        <mesh ref={railFill} geometry={geo.railFill} material={mat.limeFade} position={[-RAIL.length / 2, 0, 0.002]} />
        {RAIL.stations.map((x, i) => (
          <mesh
            key={x}
            ref={(m) => {
              nodes.current[i] = m;
            }}
            geometry={geo.node}
            material={mat.rail}
            position={[x, 0, 0.02]}
          />
        ))}
        <mesh ref={railBead} geometry={geo.bead} material={mat.limeFade} position={[0, 0, 0.05]} />
        {/* Beat 2: what the policy decides at each step, hanging under its station. */}
        {RAIL.stations.map((x, i) => (
          <group
            key={x}
            ref={(g) => {
              tiles.current[i] = g;
            }}
            position={[x, -0.36, 0.02]}
          >
            <mesh geometry={geo.bar} material={mat.rail} position={[0, 0.24, -0.01]} scale={[0.016, 0.16, 1]} />
            <mesh geometry={geo.tile} material={mat.tile} />
            {i === 0 ? (
              // Envelope: a flap over a body.
              <>
                <mesh geometry={geo.bar} material={mat.tileGlyph} position={[-0.075, 0.035, 0.036]} rotation={[0, 0, -0.58]} scale={[0.19, 0.022, 1]} />
                <mesh geometry={geo.bar} material={mat.tileGlyph} position={[0.075, 0.035, 0.036]} rotation={[0, 0, 0.58]} scale={[0.19, 0.022, 1]} />
                <mesh geometry={geo.bar} material={mat.tileGlyph} position={[0, -0.075, 0.036]} scale={[0.3, 0.022, 1]} />
                <mesh geometry={geo.bar} material={mat.tileGlyph} position={[-0.14, -0.015, 0.036]} scale={[0.022, 0.14, 1]} />
                <mesh geometry={geo.bar} material={mat.tileGlyph} position={[0.14, -0.015, 0.036]} scale={[0.022, 0.14, 1]} />
              </>
            ) : i === 1 ? (
              // Template wording: three lines of text.
              [0.07, 0, -0.07].map((y, n) => <mesh key={y} geometry={geo.bar} material={mat.tileGlyph} position={[n === 2 ? -0.04 : 0, y, 0.036]} scale={[n === 2 ? 0.2 : 0.28, 0.026, 1]} />)
            ) : (
              // Chat: three dots.
              [-0.09, 0, 0.09].map((x2) => <mesh key={x2} geometry={geo.disc} material={mat.tileGlyph} position={[x2, 0, 0.04]} scale={0.26} />)
            )}
          </group>
        ))}
      </group>

      <group ref={person} position={[1.2, -0.93, 0.02]}>
        <mesh geometry={geo.torso} material={mat.prop} />
        <mesh geometry={geo.head} material={mat.prop} position={[0, 0.52, 0]} />
        <group ref={personTick} position={[0.3, 0.68, 0.06]}>
          <mesh geometry={geo.disc} material={mat.limeSolid} scale={0.9} />
          <mesh geometry={geo.check} material={mat.inkSolid} position={[0, 0, 0.02]} scale={0.9} />
        </group>
      </group>

      <group ref={clock} position={[-1, 1, 0.2]} rotation={[0, 0.18, 0]}>
        <mesh geometry={geo.clockFace} material={mat.dial} />
        <mesh geometry={geo.clockRing} material={mat.prop} />
        <mesh ref={clockWindow} geometry={geo.clockWindow} material={mat.dialWindow} position={[0, 0, 0.017]} />
        <instancedMesh ref={clockMarks} args={[geo.bar, mat.inkSolid, CLOCK_MARKS]} />
        <mesh ref={clockHour} geometry={geo.clockHour} material={mat.inkSolid} position={[0, 0, 0.03]} />
        <mesh ref={clockMinute} geometry={geo.clockMinute} material={mat.prop} position={[0, 0, 0.04]} />
        <mesh geometry={geo.clockCap} material={mat.limeSolid} position={[0, 0, 0.05]} />
      </group>

      <group ref={plane}>
        <mesh geometry={geo.planeWings} material={mat.wing} />
        <mesh geometry={geo.planeKeel} material={mat.keel} />
      </group>
      <instancedMesh ref={trail} args={[geo.dot, mat.keel, TRAIL_DOTS]} />

      <group ref={bubble}>
        <mesh geometry={geo.bubble} material={mat.paper} />
        <mesh geometry={geo.tail} material={mat.paper} position={[-0.38, -0.32, 0.02]} rotation={[0, 0, Math.PI * 0.75]} />
        <mesh geometry={geo.calendar} material={mat.promised} position={[0, 0, 0.06]} />
        <mesh geometry={geo.check} material={mat.inkSolid} position={[0, -0.02, 0.08]} scale={0.9} />
      </group>

      <group ref={seal} position={[0.05, 1.8, 0.12]}>
        <mesh geometry={geo.seal} material={mat.prop} />
        <mesh geometry={geo.sealCheck} material={mat.limeSolid} position={[0, 0, 0.05]} />
      </group>
    </>
  );
}
