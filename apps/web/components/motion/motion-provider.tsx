"use client";

// Motion's reducedMotion="user" turns transform/layout animations off for people who asked for less motion and keeps
// opacity/colour (§6.4). Verified: MotionConfig is exported from "motion/react" (it re-exports framer-motion).
import { MotionConfig } from "motion/react";

export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
