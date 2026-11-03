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
  LineCurve3,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Shape,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from "three";
import type { Group, InstancedMesh, Mesh } from "three";
import {
  CARD,
  COLORS,
  RING,
  RING_FRONT,
  cameraAt,
  clamp,
  damp,
  ringAngle,
  ringCardPosition,
  ringCardState,
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

/** Low-poly paper plane: four triangles. */
function paperPlane(): BufferGeometry {
  const g = new BufferGeometry();
  const p = [0, 0, 0.5, -0.35, 0, -0.3, 0, 0.02, -0.2, 0, 0, 0.5, 0, 0.02, -0.2, 0.35, 0, -0.3, 0, 0, 0.5, 0, 0.02, -0.2, 0, -0.15, -0.25];
  g.setAttribute("position", new Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  return g;
}

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
    const frameShape = roundedRect(CARD.width + 0.16, CARD.height + 0.16, CARD.radius + 0.06);
    frameShape.holes.push(roundedRect(CARD.width + 0.04, CARD.height + 0.04, CARD.radius + 0.02));
    const frame = new ExtrudeGeometry(frameShape, { depth: 0.01, bevelEnabled: false, curveSegments: 4 });
    const bar = new BoxGeometry(1, 1, 0.006);
    const disc = new CylinderGeometry(0.14, 0.14, 0.02, 24);
    disc.rotateX(Math.PI / 2);
    const check = checkStroke(0.16);
    const sheet = new PlaneGeometry(2.6, 1.7);
    const railBar = new BoxGeometry(4.2, 0.03, 0.03);
    const tick = new BoxGeometry(0.05, 0.22, 0.05);
    const stampHandle = new CylinderGeometry(0.05, 0.065, 0.32, 16);
    const stampBase = new CylinderGeometry(0.17, 0.17, 0.07, 32);
    const head = new SphereGeometry(0.16, 20, 16);
    const shoulders = new TorusGeometry(0.24, 0.1, 10, 24, Math.PI);
    const clockRing = new TorusGeometry(0.34, 0.04, 10, 40);
    const clockHand = new BoxGeometry(0.03, 0.26, 0.02);
    clockHand.translate(0, 0.12, 0);
    const plane = paperPlane();
    const bubble = new ExtrudeGeometry(roundedRect(0.9, 0.62, 0.14), { depth: 0.04, bevelEnabled: false, curveSegments: 4 });
    const tail = new ConeGeometry(0.1, 0.22, 4);
    const calendar = new BoxGeometry(0.36, 0.3, 0.02);
    const seal = new CylinderGeometry(0.32, 0.32, 0.06, 40);
    seal.rotateX(Math.PI / 2);
    const sealCheck = checkStroke(0.3);
    const receipt = new PlaneGeometry(0.7, 1.0);
    const blob = new PlaneGeometry(1.4, 1.4);
    return { card, frame, bar, disc, check, sheet, railBar, tick, stampHandle, stampBase, head, shoulders, clockRing, clockHand, plane, bubble, tail, calendar, seal, sealCheck, receipt, blob };
  }, []);

  const mat = useMemo(() => {
    const blobMap = typeof document === "undefined" ? null : blobTexture();
    return {
      ring: new MeshStandardMaterial({ color: "#ffffff", roughness: 0.55, metalness: 0, transparent: true }),
      ringBars: new MeshStandardMaterial({ color: "#ffffff", roughness: 0.55, metalness: 0, transparent: true }),
      lime: new MeshStandardMaterial({ color: COLORS.lime, roughness: 0.5, metalness: 0, transparent: true }),
      ink: new MeshStandardMaterial({ color: COLORS.ink, roughness: 0.6, metalness: 0, transparent: true }),
      story: new MeshStandardMaterial({ color: COLORS.stone, roughness: 0.55, metalness: 0 }),
      storyBar: new MeshStandardMaterial({ color: COLORS.barStone, roughness: 0.55, metalness: 0 }),
      prop: new MeshStandardMaterial({ color: COLORS.prop, roughness: 0.55, metalness: 0, transparent: true }),
      rail: new MeshStandardMaterial({ color: COLORS.rail, roughness: 0.55, metalness: 0, transparent: true }),
      paper: new MeshStandardMaterial({ color: COLORS.paper, roughness: 0.6, metalness: 0, transparent: true, side: DoubleSide }),
      sheet: new MeshStandardMaterial({ color: COLORS.paper, roughness: 0.8, metalness: 0, transparent: true, side: DoubleSide }),
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
  const outline = useRef<Mesh>(null);
  const storyCheck = useRef<Group>(null);
  const sheet = useRef<Group>(null);
  const rail = useRef<Group>(null);
  const activeTick = useRef<Mesh>(null);
  const stamp = useRef<Group>(null);
  const person = useRef<Group>(null);
  const clock = useRef<Group>(null);
  const clockHand = useRef<Mesh>(null);
  const plane = useRef<Mesh>(null);
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
    story: storyAt(0),
    first: true,
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
      mat.lime.opacity = Math.max(s.ringOpacity, s.check, s.seal.visible, s.outline, s.activeTick * s.rail);
      mat.ink.opacity = mat.lime.opacity;
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
    if (outline.current) outline.current.scale.setScalar(Math.max(0.0001, s.outline));
    if (storyCheck.current) storyCheck.current.scale.setScalar(Math.max(0.0001, s.check));

    // ---- Props ----
    if (sheet.current) {
      sheet.current.visible = s.sheet > 0.01;
      mat.sheet.opacity = s.sheet * 0.9;
    }
    if (rail.current) {
      rail.current.visible = s.rail > 0.01;
      mat.rail.opacity = s.rail;
    }
    if (activeTick.current) activeTick.current.material = s.activeTick > 0.5 ? mat.lime : mat.rail;
    if (stamp.current) {
      stamp.current.visible = s.stamp.visible > 0.01;
      // Approaches the card face from the front, presses (z → 0.06), then lifts away.
      stamp.current.position.set(0.28, -0.32 + (1 - s.stamp.visible) * 0.8, 0.06 + (1 - s.stamp.press) * 0.7);
      mat.prop.opacity = 1;
    }
    if (person.current) {
      person.current.visible = s.person > 0.01;
      person.current.scale.setScalar(Math.max(0.0001, s.person));
    }
    if (clock.current) {
      clock.current.visible = s.clock.visible > 0.01;
      clock.current.scale.setScalar(Math.max(0.0001, s.clock.visible));
      if (clockHand.current) clockHand.current.rotation.z = -s.clock.sweep * Math.PI * 1.25;
    }
    if (plane.current) {
      plane.current.visible = s.plane.visible > 0;
      const p = arc.getPointAt(clamp(s.plane.along));
      const ahead = arc.getPointAt(clamp(s.plane.along + 0.02));
      plane.current.position.copy(p);
      plane.current.lookAt(ahead);
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
        <mesh ref={storyCard} geometry={geo.card} material={mat.story} position={[0, 0, -CARD.depth / 2]} />
        {BARS.map(([x, y, w, h], i) => (
          <mesh key={i} geometry={geo.bar} material={mat.storyBar} position={[x, y, CARD.depth / 2 + 0.004]} scale={[w, h, 1]} />
        ))}
        <mesh ref={outline} geometry={geo.frame} material={mat.lime} position={[0, 0, -0.005]} />
        <group ref={storyCheck} position={[0.34, -0.5, CARD.depth / 2 + 0.02]}>
          <mesh geometry={geo.disc} material={mat.lime} scale={1.4} />
          <mesh geometry={geo.check} material={mat.ink} position={[0, 0, 0.02]} scale={1.4} />
        </group>
        <mesh ref={receipt} geometry={geo.receipt} material={mat.paper} />
        <mesh geometry={geo.blob} material={mat.blob} position={[0, -0.95, -0.1]} rotation={[-Math.PI / 2, 0, 0]} />
      </group>

      <group ref={sheet} position={[-0.4, -0.75, 0]} rotation={[-Math.PI / 2.3, 0, 0]}>
        <mesh geometry={geo.sheet} material={mat.sheet} />
        {[-0.85, -0.42, 0, 0.42, 0.85].map((y) => (
          <mesh key={`h${y}`} geometry={geo.bar} material={mat.rail} position={[0, y * 0.95, 0.005]} scale={[2.5, 0.015, 1]} />
        ))}
        {[-0.65, 0, 0.65].map((x) => (
          <mesh key={`v${x}`} geometry={geo.bar} material={mat.rail} position={[x, 0, 0.005]} scale={[0.015, 1.6, 1]} />
        ))}
      </group>

      <group ref={rail} position={[0, -0.95, 0]}>
        <mesh geometry={geo.railBar} material={mat.rail} />
        <mesh ref={activeTick} geometry={geo.tick} material={mat.rail} position={[-1.2, 0, 0]} />
        <mesh geometry={geo.tick} material={mat.rail} position={[0, 0, 0]} />
        <mesh geometry={geo.tick} material={mat.rail} position={[1.2, 0, 0]} />
      </group>

      <group ref={stamp} position={[0.28, -0.32, 0.76]}>
        <mesh geometry={geo.stampBase} material={mat.prop} rotation={[Math.PI / 2, 0, 0]} />
        <mesh geometry={geo.stampHandle} material={mat.prop} position={[0, 0, 0.2]} rotation={[Math.PI / 2, 0, 0]} />
      </group>

      <group ref={person} position={[1.05, -0.35, 0.2]}>
        <mesh geometry={geo.head} material={mat.prop} position={[0, 0.32, 0]} />
        <mesh geometry={geo.shoulders} material={mat.prop} position={[0, -0.05, 0]} />
      </group>

      <group ref={clock} position={[-1.1, 0.95, 0.2]}>
        <mesh geometry={geo.clockRing} material={mat.prop} />
        <mesh ref={clockHand} geometry={geo.clockHand} material={mat.prop} position={[0, 0, 0.02]} />
      </group>

      <mesh ref={plane} geometry={geo.plane} material={mat.prop} scale={0.8} />

      <group ref={bubble}>
        <mesh geometry={geo.bubble} material={mat.paper} />
        <mesh geometry={geo.tail} material={mat.paper} position={[-0.38, -0.32, 0.02]} rotation={[0, 0, Math.PI * 0.75]} />
        <mesh geometry={geo.calendar} material={mat.promised} position={[0, 0, 0.06]} />
        <mesh geometry={geo.check} material={mat.ink} position={[0, -0.02, 0.08]} scale={0.9} />
      </group>

      <group ref={seal} position={[0.05, 1.8, 0.12]}>
        <mesh geometry={geo.seal} material={mat.prop} />
        <mesh geometry={geo.sealCheck} material={mat.lime} position={[0, 0, 0.05]} />
      </group>
    </>
  );
}
