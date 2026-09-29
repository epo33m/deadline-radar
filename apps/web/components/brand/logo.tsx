import type { SVGProps } from "react";

import { cn } from "@/lib/utils";

interface LogoProps extends SVGProps<SVGSVGElement> {
  size?: number;
  className?: string;
  strokeWidth?: number;
}

/**
 * Deadline Radar Brand Logo (Monoline / Line Art / Outline).
 *
 * Minimalist stroke-only visual identity combining:
 * - Concentric radar tracking range rings & 45° radar sweep ray
 * - Floating calendar / deadline schedule badge at bottom-right
 * - Transparent interior with consistent monoline stroke geometry
 */
export function BrandLogo({
  size = 24,
  className,
  strokeWidth = 1.8,
  ...props
}: LogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={size}
      height={size}
      className={cn("shrink-0", className)}
      aria-label="Deadline Radar logo"
      role="img"
      {...props}
    >
      {/* Outer Open Radar Arc (270 degrees) */}
      <path d="M 12 2.5 A 9.5 9.5 0 1 0 21.5 12" />

      {/* Middle Open Radar Arc (270 degrees) */}
      <path d="M 12 6.2 A 5.8 5.8 0 1 0 17.8 12" />

      {/* Center Radar Pulse Core */}
      <circle cx="12" cy="12" r="1.8" />

      {/* Radar Sweep Ray (45° Angle Line) */}
      <path d="M 13.3 10.7 L 18.7 5.3" />
    </svg>
  );
}
