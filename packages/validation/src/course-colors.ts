/**
 * Canonical course color system — the single source of truth.
 *
 * The 12 `light` values are the ONLY system values: they are persisted
 * and displayed. `dark` is reserved for a future appearance mode.
 * Any other valid `#RRGGBB` hex is a "custom" color: still accepted and
 * preserved, but it is not a system color.
 */

export type CourseColorToken = {
  token: string;
  label: string;
  light: string;
  dark: string;
  appleName: string;
};

export const SYSTEM_COLOR_TOKENS: readonly CourseColorToken[] = [
  {
    token: "system-red",
    label: "Red",
    light: "#ff383c",
    dark: "#ff453a",
    appleName: "systemRed",
  },
  {
    token: "system-orange",
    label: "Orange",
    light: "#ff8d28",
    dark: "#ff9f0a",
    appleName: "systemOrange",
  },
  {
    token: "system-yellow",
    label: "Yellow",
    light: "#ffcc00",
    dark: "#ffd60a",
    appleName: "systemYellow",
  },
  {
    token: "system-green",
    label: "Green",
    light: "#34c759",
    dark: "#30d158",
    appleName: "systemGreen",
  },
  {
    token: "system-mint",
    label: "Mint",
    light: "#00c8b3",
    dark: "#63e6e2",
    appleName: "systemMint",
  },
  {
    token: "system-teal",
    label: "Teal",
    light: "#00c3d0",
    dark: "#40c8e0",
    appleName: "systemTeal",
  },
  {
    token: "system-cyan",
    label: "Cyan",
    light: "#00c0e8",
    dark: "#64d2ff",
    appleName: "systemCyan",
  },
  {
    token: "system-blue",
    label: "Blue",
    light: "#0088ff",
    dark: "#0a84ff",
    appleName: "systemBlue",
  },
  {
    token: "system-indigo",
    label: "Indigo",
    light: "#6155f5",
    dark: "#5e5ce6",
    appleName: "systemIndigo",
  },
  {
    token: "system-purple",
    label: "Purple",
    light: "#cb30e0",
    dark: "#bf5af2",
    appleName: "systemPurple",
  },
  {
    token: "system-pink",
    label: "Pink",
    light: "#ff2d55",
    dark: "#ff375f",
    appleName: "systemPink",
  },
  {
    token: "system-brown",
    label: "Brown",
    light: "#ac7f5e",
    dark: "#ac8e68",
    appleName: "systemBrown",
  },
] as const;

export const NO_COURSE_COLOR = {
  token: "none",
  label: "None",
  light: "",
  dark: "",
  appleName: "",
} as const satisfies CourseColorToken;

export const CUSTOM_COURSE_COLOR_LABEL = "Custom";

export type CourseColorGroup = {
  label: string;
  options: readonly CourseColorToken[];
};

export const COURSE_COLOR_GROUPS: readonly CourseColorGroup[] = [
  {
    label: "Default",
    options: SYSTEM_COLOR_TOKENS,
  },
];

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const paletteByHex = new Map<string, CourseColorToken>();
for (const option of SYSTEM_COLOR_TOKENS) {
  paletteByHex.set(option.light.toLowerCase(), option);
  paletteByHex.set(option.dark.toLowerCase(), option);
}

export function isHexColor(value: string | null | undefined): boolean {
  if (!value) return false;
  return HEX_COLOR.test(value.trim());
}

export type CourseColorKind = "none" | "system" | "custom";

/** Classify a stored color: empty/invalid → none, palette → system, else custom. */
export function getCourseColorKind(
  value: string | null | undefined,
): CourseColorKind {
  if (!value) return "none";
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) return "none";
  if (paletteByHex.has(normalized)) return "system";
  return HEX_COLOR.test(value.trim()) ? "custom" : "none";
}

export function isSystemCourseColor(
  value: string | null | undefined,
): boolean {
  return getCourseColorKind(value) === "system";
}

export function findCourseColorOption(
  value: string | null | undefined,
): CourseColorToken | undefined {
  if (!value) return NO_COURSE_COLOR;
  return paletteByHex.get(value.trim().toLowerCase());
}

export function getCourseColorLabel(value: string | null | undefined): string {
  if (!value) return NO_COURSE_COLOR.label;
  const option = findCourseColorOption(value);
  if (option) return option.label;
  return isHexColor(value) ? CUSTOM_COURSE_COLOR_LABEL : NO_COURSE_COLOR.label;
}

/** Fill for course surfaces — palette light value, custom hex as-is, else null. */
export function getCourseColorFill(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const option = findCourseColorOption(value);
  if (option && option.token !== "none") return option.light;
  const trimmed = value.trim();
  return HEX_COLOR.test(trimmed) ? trimmed.toLowerCase() : null;
}

/**
 * Persist system colors as the canonical light hex; preserve custom hex;
 * empty/invalid → none.
 */
export function normalizeCourseColorForStorage(
  value: string | null | undefined,
): string {
  if (!value) return "";
  const option = findCourseColorOption(value);
  if (option && option.token !== "none") return option.light;
  const trimmed = value.trim();
  return HEX_COLOR.test(trimmed) ? trimmed.toLowerCase() : "";
}

/** Picker swatch border — based on light appearance only. */
export function isLightCourseColor(value: string | null | undefined): boolean {
  if (!value) return true;
  const hex = value.replace("#", "");
  if (hex.length !== 6) return false;
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 210;
}
