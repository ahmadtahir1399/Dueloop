// Phase 6: the Loop is a pure function of (beat, time). These lock the §6.2.4 table and the scroll mapping.
import { describe, expect, it } from 'vitest';
import { beatFromBlocks, BEAT_COUNT, CAMERA, cameraAt, damp, ringAngle, ringCardState, RING, splitBeat, storyAt } from '../features/landing/three/keyframes.ts';
import { decideTier, watchdogStep, type TierInputs } from '../features/landing/three/tier.ts';

describe('keyframes', () => {
  it('has one camera keyframe per beat, matching the spec table', () => {
    expect(CAMERA).toHaveLength(BEAT_COUNT);
    expect(CAMERA[0]).toEqual({ position: [0, 1.2, 9], target: [0, 0, 0] });
    expect(CAMERA[4]).toEqual({ position: [1.5, 1.4, 6.5], target: [1.2, 0.5, 0] });
    expect(CAMERA[7]).toEqual({ position: [0, 1.4, 9], target: [0, 0, 0] });
  });
  it('holds each beat while its text is read, then moves', () => {
    for (let b = 0; b < BEAT_COUNT; b++) expect(cameraAt(b + 0.3)).toEqual(cameraAt(b));
    expect(cameraAt(0.99).position[2]).toBeCloseTo(6.5, 1);
  });
  it('splits beats and clamps', () => {
    expect(splitBeat(3.25)).toEqual({ index: 3, local: 0.25 });
    expect(splitBeat(-1).index).toBe(0);
    expect(splitBeat(99).index).toBe(7);
  });
  it('is deterministic, so scrolling back plays the story in reverse', () => {
    for (const b of [0.2, 1.7, 3.5, 4.6, 6.4, 7.8]) expect(storyAt(b)).toEqual(storyAt(b));
    const forward = [3.1, 3.5, 3.6].map((b) => storyAt(b).stamp.press);
    const back = [3.6, 3.5, 3.1].map((b) => storyAt(b).stamp.press);
    expect(back).toEqual([...forward].reverse());
  });
  it('tells the story beat by beat', () => {
    expect(storyAt(0.2).cardOut).toBe(0);
    expect(storyAt(1.5).sheet).toBe(1);
    expect(storyAt(2.8).activeTick).toBe(1);
    expect(storyAt(3.55).stamp.press).toBeGreaterThan(0.5);
    expect(storyAt(3.5).outline).toBe(1);
    expect(storyAt(4.2).clock.sweep).toBeGreaterThan(0);
    expect(storyAt(4.2).plane.visible).toBe(0);
    expect(storyAt(4.7).plane.visible).toBe(1);
    expect(storyAt(5.8).cardColor).toBe('promised');
    expect(storyAt(5.8).cardColorMix).toBe(1);
    expect(storyAt(6.6).seal.drop).toBeGreaterThan(0.9);
    const close = storyAt(7.99);
    expect(close.cardColor).toBe('evergreen');
    expect(close.cardOut).toBeLessThan(0.05);
    expect(close.ringOpacity).toBe(1);
    expect(close.ringGreenWave).toBeGreaterThan(0.95);
  });
  it('turns once a minute; cards go green as they pass the front and reset at the back', () => {
    expect(ringAngle(0)).toBe(0);
    expect(ringAngle(RING.periodMs / 2)).toBeCloseTo(Math.PI);
    expect(ringCardState(0, 12, 0.5).green).toBe(1);
    expect(ringCardState(0, 12, Math.PI + 0.5).green).toBe(0);
    expect(ringCardState(0, 12, 2 * Math.PI - 0.3).warm).toBeGreaterThan(0);
    expect(ringCardState(5, 12, Math.PI + 1, 1).green).toBe(1);
  });
  it('maps scroll positions to a continuous beat', () => {
    const blocks = [0, 1, 2, 3].map((i) => [i * 100 - 150, 100] as const);
    expect(beatFromBlocks(blocks, 0)).toBeCloseTo(1.5);
    expect(beatFromBlocks(blocks, -500)).toBe(0);
  });
  it('damps towards the target', () => {
    expect(damp(0, 1, 0)).toBe(0);
    expect(damp(0, 1, 1, 25)).toBeGreaterThan(0.99);
  });
});

describe('quality tiers', () => {
  const base: TierInputs = { reducedMotion: false, webgl2: true, saveData: false, userOff: false, viewportWidth: 1440, cores: 8, memoryGb: 8 };
  it('Tier 2 on a capable desktop', () => expect(decideTier(base)).toBe(2));
  it('Tier 1 below 1024 px or on a weaker device', () => {
    expect(decideTier({ ...base, viewportWidth: 390 })).toBe(1);
    expect(decideTier({ ...base, cores: 4 })).toBe(1);
    expect(decideTier({ ...base, memoryGb: 4 })).toBe(1);
    expect(decideTier({ ...base, memoryGb: undefined })).toBe(2);
  });
  it('Tier 0 for reduced motion, no WebGL2, data saver or a remembered pause', () => {
    for (const k of ['reducedMotion', 'saveData', 'userOff'] as const) expect(decideTier({ ...base, [k]: true })).toBe(0);
    expect(decideTier({ ...base, webgl2: false })).toBe(0);
  });
  it('the watchdog drops a tier only when the 3 s average is below the floor', () => {
    let s = { elapsed: 0, frames: 0 };
    let dropped = false;
    for (let i = 0; i < 100; i++) {
      const r = watchdogStep(s, 33.4, 2);
      s = r.state;
      dropped ||= r.drop;
    }
    expect(dropped).toBe(true);
    s = { elapsed: 0, frames: 0 };
    dropped = false;
    for (let i = 0; i < 400; i++) {
      const r = watchdogStep(s, 16.7, 2);
      s = r.state;
      dropped ||= r.drop;
    }
    expect(dropped).toBe(false);
  });
});
