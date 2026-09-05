/**
 * Apple HIG system colors — light and dark sRGB from Specifications.
 * @see https://developer.apple.com/design/human-interface-guidelines/color#System-colors
 *
 * Persist and display the light value. Dark is reserved for appearance mode later.
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
    light: "#ff3b30",
    dark: "#ff453a",
    appleName: "systemRed",
  },
  {
    token: "system-orange",
    label: "Orange",
    light: "#ff9500",
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
    light: "#00c7be",
    dark: "#63e6e2",
    appleName: "systemMint",
  },
  {
    token: "system-teal",
    label: "Teal",
    light: "#30b0c7",
    dark: "#40c8e0",
    appleName: "systemTeal",
  },
  {
    token: "system-cyan",
    label: "Cyan",
    light: "#32ade6",
    dark: "#64d2ff",
    appleName: "systemCyan",
  },
  {
    token: "system-blue",
    label: "Blue",
    light: "#007aff",
    dark: "#0a84ff",
    appleName: "systemBlue",
  },
  {
    token: "system-indigo",
    label: "Indigo",
    light: "#5856d6",
    dark: "#5e5ce6",
    appleName: "systemIndigo",
  },
  {
    token: "system-purple",
    label: "Purple",
    light: "#af52de",
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
    light: "#a2845e",
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

/** Older stored blues → current HIG systemBlue light. */
const LEGACY_COLOR_ALIASES: ReadonlyMap<string, string> = new Map([
  ["#0071e3", "#007aff"],
]);

const paletteByHex = new Map<string, CourseColorToken>();
for (const option of SYSTEM_COLOR_TOKENS) {
  paletteByHex.set(option.light.toLowerCase(), option);
  paletteByHex.set(option.dark.toLowerCase(), option);
}

function normalizeCourseColorValue(value: string): string {
  const normalized = value.trim().toLowerCase();
  return LEGACY_COLOR_ALIASES.get(normalized) ?? normalized;
}

export function findCourseColorOption(
  value: string | null | undefined,
): CourseColorToken | undefined {
  if (!value) return NO_COURSE_COLOR;
  return paletteByHex.get(normalizeCourseColorValue(value));
}

export function getCourseColorLabel(value: string | null | undefined): string {
  if (!value) return NO_COURSE_COLOR.label;
  return findCourseColorOption(value)?.label ?? NO_COURSE_COLOR.label;
}

/** Solid fill for list rows — palette light value, or null for None. */
export function getCourseColorFill(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const option = findCourseColorOption(value);
  if (option && option.token !== "none") return option.light;
  return null;
}

/** Persist palette colors as the canonical light hex; unknown → none. */
export function normalizeCourseColorForStorage(
  value: string | null | undefined,
): string {
  if (!value) return "";
  const option = findCourseColorOption(value);
  if (option && option.token !== "none") return option.light;
  return "";
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
