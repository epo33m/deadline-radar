"use client";

import * as React from "react";

import { BrandLogo } from "@/components/brand/logo";
import { FadeIn } from "@/components/landing/fade-in";
import { shellContainerClassName } from "@/components/ui/shell-layout";
import { cn } from "@/lib/utils";
import styles from "./notification-showcase.module.css";

/**
 * Fixed design size of the device mockup. The frame is authored at these
 * exact pixels and scaled to fit narrower viewports (see `ScaledMockup`),
 * so the composition never reflows or crops.
 */
const MOCKUP_WIDTH = 1280;
const MOCKUP_HEIGHT = 700;

/**
 * Scales the fixed-size mockup down to fit its container, letting the
 * wrapper collapse to the scaled height. Below the design width the whole
 * scene — chassis, wallpaper, pills — shrinks as one unit instead of
 * cropping the right-aligned notification stack.
 */
function ScaledMockup({ children }: { children: React.ReactNode }) {
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = React.useState(1);

  React.useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () =>
      setScale(Math.min(1, el.clientWidth / MOCKUP_WIDTH));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={wrapRef}
      className="w-full overflow-hidden"
      style={{ height: MOCKUP_HEIGHT * scale }}
    >
      <div
        style={{
          width: MOCKUP_WIDTH,
          height: MOCKUP_HEIGHT,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function MenuBar() {
  return (
    <header className="z-20 flex h-11 w-full items-center justify-end gap-5 px-10 text-white">
      <svg
        className="h-[18px] w-[18px] fill-current drop-shadow-[0_1px_2px_rgba(0,0,0,0.1)]"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path d="M12 4C7.31 4 3.07 5.9 0 8.98L1.42 10.4C4.09 7.74 7.84 6 12 6s7.91 1.74 10.58 4.4L24 8.98C20.93 5.9 16.69 4 12 4zm0 4.5c-3.52 0-6.7 1.43-9.01 3.75l1.41 1.41c1.94-1.95 4.62-3.16 7.6-3.16s5.66 1.21 7.6 3.16l1.41-1.41C18.7 9.93 15.52 8.5 12 8.5zm0 4.5c-2.34 0-4.46.95-6 2.5l6 6.5 6-6.5c-1.54-1.55-3.66-2.5-6-2.5z" />
      </svg>
      <div className="flex items-center gap-[1.5px]">
        <div className="flex h-[12.5px] w-[25px] items-center rounded-[4px] border-[1.75px] border-white/95 p-[1.5px]">
          <div className="h-full w-[88%] rounded-[1.5px] bg-white" />
        </div>
        <div className="h-[4.5px] w-[1.75px] rounded-r-[1.5px] bg-white/95" />
      </div>
      <svg
        className="h-[18px] w-[18px] fill-white"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          clipRule="evenodd"
          d="M4 6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3 3 3 0 0 1-3 3H7a3 3 0 0 1-3-3zm12-1.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM7 15a3 3 0 0 0-3 3 3 3 0 0 0 3 3h10a3 3 0 0 0 3-3 3 3 0 0 0-3-3H7zm1 1.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z"
          fillRule="evenodd"
        />
      </svg>
      <span className="ml-1 text-[14.5px] font-medium tracking-normal">
        Tue Apr 1 &nbsp;9:41 AM
      </span>
    </header>
  );
}

function IPhoneMockup() {
  return (
    <div className="mx-auto flex w-full max-w-[360px] justify-center sm:max-w-[400px]">
      <div
        className={cn(
          styles.macWallpaper,
          "relative flex aspect-[4/4.5] w-full flex-col justify-end overflow-hidden rounded-b-[44px] rounded-t-none border-x-[10px] border-b-[10px] border-t-0 border-[#121212] px-3 pb-2 pt-6 shadow-[0_20px_50px_rgba(0,0,0,0.35),0_0_0_2px_#27272a,0_0_0_4px_#18181b] sm:px-4",
        )}
      >
        {/* Lock screen layout */}
        <div className="relative z-10 flex w-full flex-col justify-end">
          {/* Push notification banner */}
          <article
            className={cn(
              styles.notificationPill,
              "mb-5 w-full rounded-[22px] p-3 sm:mb-7 sm:rounded-[24px] sm:p-3.5",
            )}
          >
            <div className="flex items-start gap-3">
              <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-primary text-white shadow-xs">
                <BrandLogo size={22} className="text-white" strokeWidth={2} />
              </div>
              <div className="min-w-0 flex-1 pr-1">
                <div className="flex items-baseline justify-between gap-1">
                  <span className="truncate text-[13.5px] font-bold tracking-tight text-[#1c1c1e] sm:text-[14px]">
                    Deadline Radar
                  </span>
                  <span className="shrink-0 text-[11.5px] font-normal tracking-tight text-[#6c6c70]">
                    now
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[13px] font-bold tracking-tight text-[#111315] sm:text-[13.5px]">
                  Assignment due tomorrow
                </p>
                <p className="text-[12px] font-normal leading-snug tracking-tight text-[#2c3138] sm:text-[12.5px]">
                  Problem Set 4 for Calculus II is due tomorrow at 11:59 PM.
                </p>
              </div>
            </div>
          </article>

          {/* Quick Actions (Flashlight & Camera) */}
          <div className="mb-6 flex items-center justify-between px-6 sm:mb-7 sm:px-7">
            <div
              aria-label="Flashlight"
              className={cn(
                styles.iosActionButton,
                "flex h-11 w-11 items-center justify-center rounded-full text-white/90 shadow-sm",
              )}
            >
              <svg className="h-5 w-5 fill-current" viewBox="0 0 24 24">
                <path d="M6 2h12v3l-2.5 3.5V13H8.5V8.5L6 5V2zm2 2v.5l2.5 3.5V11h3V8L16 4.5V4H8zm0 11h8v7H8v-7zm2 2v3h4v-3h-4z" />
              </svg>
            </div>
            <div
              aria-label="Camera"
              className={cn(
                styles.iosActionButton,
                "flex h-11 w-11 items-center justify-center rounded-full text-white/90 shadow-sm",
              )}
            >
              <svg className="h-5 w-5 fill-current" viewBox="0 0 24 24">
                <path d="M4 4h3l2-2h6l2 2h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm8 14a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0-2a3 3 0 1 1 0-6 3 3 0 0 1 0 6z" />
              </svg>
            </div>
          </div>

          {/* Home indicator */}
          <div className="flex w-full justify-center pb-1">
            <div className="h-1 w-32 rounded-full bg-white/90 shadow-xs" />
          </div>
        </div>
      </div>
    </div>
  );
}

function IPadMockup() {
  return (
    <div className="mx-auto w-full max-w-[760px]">
      <div className="relative overflow-hidden rounded-t-[38px] border-x-[12px] border-t-[12px] border-b-0 border-[#1c1c1e] bg-[#1c1c1e] shadow-2xl sm:rounded-t-[44px] sm:border-x-[14px] sm:border-t-[14px]">
        {/* Display Screen */}
        <div
          className={cn(
            styles.macWallpaper,
            "relative flex h-[500px] w-full flex-col overflow-hidden rounded-t-[26px] select-none shadow-inner sm:h-[540px] sm:rounded-t-[30px]",
          )}
        >
          {/* Top Status Bar */}
          <header className="relative z-20 flex w-full items-center justify-end px-3 pt-3 text-white/90">
            <div className="flex items-center space-x-1.5 text-white/95">
              <div className="relative flex h-[10px] w-[20px] items-center rounded-[3px] border border-white/80 p-[1px]">
                <div className="h-full w-full rounded-[1.5px] bg-white" />
                <div className="absolute -right-[3px] top-[2.5px] h-[3.5px] w-[1.5px] rounded-r-[1px] bg-white/80" />
              </div>
            </div>
          </header>

          {/* Lockscreen Clock */}
          <section className="mt-1 flex flex-col items-center text-center text-white">
            <h1 className="font-sans text-[68px] font-[250] leading-none tracking-tight text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.15)] sm:text-[78px]">
              9:41
            </h1>
            <p className="mt-1.5 text-[15px] font-medium tracking-normal text-white/95 drop-shadow-[0_1px_4px_rgba(0,0,0,0.25)] sm:text-[17px]">
              Tuesday, April 1
            </p>
          </section>

          {/* Notification Center Section matching iPadOS Lockscreen Structure */}
          <section className="z-20 mx-auto mt-4 w-full max-w-[460px] px-3">
            {/* Header: "Notification Center" + Clear button */}
            <div className="mb-2 flex items-center justify-between px-1 text-white">
              <span className="text-[17px] font-semibold tracking-tight text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.3)]">
                Notification Center
              </span>
              <button
                type="button"
                aria-label="Clear notifications"
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20 text-white/90 backdrop-blur-md transition-colors hover:bg-white/30"
              >
                <svg
                  className="h-3.5 w-3.5 stroke-current"
                  viewBox="0 0 24 24"
                  fill="none"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                >
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Notification Card */}
            <article
              className={cn(
                styles.notificationPill,
                "rounded-[20px] p-4 text-neutral-800 shadow-lg",
              )}
            >
              {/* Card Header: App Icon + App Title + Timestamp */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] bg-primary text-white shadow-xs">
                    <BrandLogo
                      size={12}
                      className="text-white"
                      strokeWidth={2.4}
                    />
                  </div>
                  <span className="text-[12px] font-bold uppercase tracking-wider text-neutral-600">
                    Deadline Radar
                  </span>
                </div>
                <span className="text-[12px] font-normal text-neutral-500">
                  now
                </span>
              </div>

              {/* Notification Content */}
              <div className="mt-2.5">
                <h2 className="text-[15px] font-bold leading-tight tracking-tight text-neutral-900">
                  Assignment due tomorrow
                </h2>
                <p className="mt-1 text-[13.5px] leading-snug text-neutral-700">
                  Problem Set 4 for Calculus II is due tomorrow at 11:59 PM.
                </p>
              </div>

              {/* More Notifications Indicator */}
              <div className="mt-2.5">
                <span className="text-[13px] font-medium text-primary">
                  2 more notifications
                </span>
              </div>
            </article>
          </section>
        </div>
      </div>
    </div>
  );
}

/**
 * Showcase section below "Get started":
 * - iPhone Lock Screen mockup on mobile / phone viewports (< sm)
 * - iPadOS Lock Screen Notification Summary on tablet / iPad viewports (sm to lg)
 * - macOS MacBook Desktop notification mockup on laptop / desktop viewports (>= lg)
 */
export function NotificationShowcase() {
  return (
    <section
      aria-labelledby="stay-in-sync"
      className="mt-12 w-full bg-white sm:mt-20 lg:mt-28"
    >
      <FadeIn
        yOffset={32}
        className={cn(
          shellContainerClassName,
          "flex flex-col items-center text-center pt-16 sm:pt-24 lg:pt-28",
        )}
      >
        <p className="text-[clamp(1rem,0.9rem+1vw,1.3125rem)] font-semibold uppercase tracking-[0.08em] text-ink">
          AT A GLANCE
        </p>
        <h2
          id="stay-in-sync"
          className="mt-3 max-w-5xl font-display text-[clamp(2.75rem,1.4rem+7vw,5.75rem)] font-semibold leading-[1.04] tracking-[-0.03em] text-balance text-ink"
        >
          Never miss a deadline
        </h2>
        <p className="mt-4 max-w-2xl text-[clamp(1.125rem,0.95rem+1.5vw,1.5rem)] leading-[1.45] text-balance text-ink-muted-64 sm:mt-5">
          Your upcoming deadlines{" "}
          <span className="text-ink">sync across your devices</span>, so you
          always know what’s due.
        </p>
      </FadeIn>

      <FadeIn
        delay={0.14}
        yOffset={44}
        className="relative left-1/2 mt-10 w-screen -translate-x-1/2 px-4 pb-20 sm:mt-14 sm:px-6 sm:pb-24 lg:px-8"
      >
        <div className="mx-auto max-w-[1312px]">
          <div className="overflow-hidden rounded-[32px] bg-canvas-parchment pt-0 px-4 pb-6 sm:pt-6 sm:px-6 sm:pb-0 lg:pt-8 lg:pr-8 lg:pb-0 lg:pl-0">
            {/* Mobile / Phone Viewport (< sm): iPhone Lock Screen Mockup */}
            <div className="block sm:hidden">
              <IPhoneMockup />
            </div>

            {/* Tablet / iPad Viewport (sm to lg): iPadOS Lock Screen Mockup */}
            <div className="hidden sm:block lg:hidden">
              <IPadMockup />
            </div>

            {/* Desktop Viewport (>= lg): MacBook macOS Desktop Mockup */}
            <div className="hidden lg:block">
              <ScaledMockup>
                <div className="flex h-full w-full flex-col overflow-hidden rounded-tr-[38px] bg-[#0a0a0b] p-[20px] pb-0 pl-0">
                  <div
                    className={cn(
                      styles.macWallpaper,
                      "flex h-full w-full flex-col rounded-tr-[24px] border-t border-r border-white/20",
                    )}
                  >
                    <MenuBar />

                    <div className="relative z-10 flex w-full flex-col items-end gap-[11px] pr-9 pt-4">
                      <article
                        className={cn(
                          styles.notificationPill,
                          "flex w-[432px] items-start gap-4 rounded-[30px] p-5",
                        )}
                      >
                        <div className="relative flex h-[58px] w-[58px] shrink-0 items-center justify-center rounded-[15px] bg-primary text-white shadow-md">
                          <BrandLogo size={32} className="text-white" strokeWidth={2} />
                        </div>
                        <div className="flex flex-1 flex-col justify-center pt-0.5 leading-snug text-[#1f2328]">
                          <div className="text-[15.5px] font-bold tracking-[-0.015em] text-[#1a1c1e]">
                            Deadline Radar
                          </div>
                          <div className="mt-[1px] text-[16px] font-bold tracking-[-0.01em] text-[#111315]">
                            Assignment due tomorrow
                          </div>
                          <p className="mt-[3px] text-[14.5px] leading-[1.3] font-normal tracking-[-0.01em] text-[#2c3138]">
                            Problem Set 4 for Calculus II is due tomorrow at
                            11:59 PM.
                          </p>
                        </div>
                      </article>
                    </div>
                  </div>
                </div>
              </ScaledMockup>
            </div>
          </div>
        </div>
      </FadeIn>
    </section>
  );
}
