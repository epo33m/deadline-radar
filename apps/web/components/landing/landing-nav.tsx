"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { BrandLogo } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

/**
 * Minimum 44x44px touch target.
 */
const touchTargetClassName =
  "relative before:absolute before:inset-x-0 before:-inset-y-2.5 before:content-['']";

/**
 * Next-gen Apple Liquid Glass pop-out navigation.
 *
 * Hidden while the hero section is in the viewport. Once the hero scrolls
 * completely out of view, this navbar smoothly pops down from the top as a
 * floating liquid glass capsule matching the exact width of the page content (`max-w-6xl`).
 *
 * Features:
 * - Ultra-deep optical blur (`backdrop-blur-2xl`) + saturation boost (`backdrop-saturate-[190%]`)
 * - Liquid refraction specular rim highlight & multi-tiered ambient depth shadows
 * - Organic fluid spring physics curve
 */
export function LandingNav() {
  const [showNav, setShowNav] = useState(false);
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    const heroElement = document.getElementById("hero");
    if (!heroElement) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        // Show navbar only when hero is completely out of view above the viewport
        const isPastHero = !entry.isIntersecting && entry.boundingClientRect.top < 0;
        setShowNav(isPastHero);
      },
      {
        threshold: 0,
      },
    );

    observer.observe(heroElement);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      aria-hidden={!showNav}
      className="pointer-events-none fixed inset-x-0 top-3 z-50 flex justify-center px-4 sm:top-4 sm:px-6 lg:px-8"
    >
      <AnimatePresence>
        {showNav && (
          <motion.header
            initial={
              shouldReduceMotion
                ? { opacity: 0 }
                : { y: -28, opacity: 0, scale: 0.96, filter: "blur(8px)" }
            }
            animate={{
              y: 0,
              opacity: 1,
              scale: 1,
              filter: "blur(0px)",
            }}
            exit={
              shouldReduceMotion
                ? { opacity: 0 }
                : { y: -28, opacity: 0, scale: 0.96, filter: "blur(8px)" }
            }
            transition={{
              type: "spring",
              stiffness: 340,
              damping: 30,
              mass: 0.8,
            }}
            className={cn(
              "relative pointer-events-auto flex h-12 w-full max-w-6xl items-center justify-between overflow-hidden rounded-full px-5 sm:h-13 sm:px-7",
              // Liquid glass material
              "bg-white/60 supports-[backdrop-filter]:bg-white/45",
              "backdrop-blur-2xl backdrop-saturate-[190%]",
              // Precision refractive borders and ambient specular reflections
              "border border-white/80 dark:border-white/20",
              "shadow-[0_10px_35px_0_rgba(0,0,0,0.06),0_2px_4px_0_rgba(0,0,0,0.03),inset_0_1px_1.5px_0_rgba(255,255,255,0.95),inset_0_-1px_1px_0_rgba(0,0,0,0.03)]",
            )}
          >
            {/* Top specular highlight sheen */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-6 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/90 to-transparent"
            />

            {/* Inner ambient light diffusion */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -top-8 left-1/2 h-14 w-3/4 -translate-x-1/2 rounded-full bg-gradient-to-b from-white/50 to-transparent blur-md"
            />

            <Link
              href="/"
              className={cn(
                touchTargetClassName,
                "relative z-10 flex items-center gap-2.5 min-w-0 truncate font-sans text-[16px] font-semibold leading-tight tracking-[-0.374px] text-ink transition-opacity [@media(hover:hover)]:hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus sm:text-[17px]",
              )}
            >
              <BrandLogo size={22} className="text-primary" strokeWidth={2} />
              <span>Deadline Radar</span>
            </Link>

            <nav
              aria-label="Primary"
              className="relative z-10 flex items-center gap-1 sm:gap-2"
            >
              <Link
                href="/login"
                className={cn(
                  touchTargetClassName,
                  "inline-flex min-h-[44px] items-center justify-center rounded-full bg-primary px-4 py-1.5 text-sm font-medium leading-tight tracking-[-0.224px] whitespace-nowrap text-on-primary shadow-[0_2px_10px_rgba(0,113,227,0.25),inset_0_1px_1px_rgba(255,255,255,0.35)] transition-all [@media(hover:hover)]:hover:opacity-90 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-focus",
                )}
              >
                Sign in
              </Link>
            </nav>
          </motion.header>
        )}
      </AnimatePresence>
    </div>
  );
}
