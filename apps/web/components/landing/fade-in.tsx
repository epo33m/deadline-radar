"use client";

import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";

interface FadeInProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  duration?: number;
  yOffset?: number;
  withBlur?: boolean;
  as?: "div" | "section" | "article" | "main" | "header";
  "aria-label"?: string;
  id?: string;
}

/**
 * Enterprise-grade smooth scroll reveal and entrance animation.
 * Features subtle optical blur dissolve + smooth deceleration glide.
 * Triggers once upon scroll/refresh, and respects reduced motion preferences.
 */
export function FadeIn({
  children,
  className,
  delay = 0,
  duration = 0.95,
  yOffset = 44,
  withBlur = true,
  as = "div",
  "aria-label": ariaLabel,
  id,
}: FadeInProps) {
  const shouldReduceMotion = useReducedMotion();
  const MotionComponent = motion[as];

  return (
    <MotionComponent
      initial={
        shouldReduceMotion
          ? { opacity: 1, y: 0, filter: "blur(0px)" }
          : {
              opacity: 0,
              y: yOffset,
              filter: withBlur ? "blur(6px)" : "blur(0px)",
            }
      }
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, amount: 0.18 }}
      transition={{
        duration: shouldReduceMotion ? 0 : duration,
        delay: shouldReduceMotion ? 0 : delay,
        ease: [0.16, 1, 0.3, 1], // Apple/Linear smooth deceleration curve
      }}
      className={cn(className)}
      aria-label={ariaLabel}
      id={id}
    >
      {children}
    </MotionComponent>
  );
}
