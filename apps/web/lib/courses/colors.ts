export * from "@deadline-radar/validation/course-colors";

/**
 * Card presentation per system token — the ONLY sanctioned card surfaces.
 * Custom colors fall back to a solid fill with the default ink icon.
 */
export type CourseCardPresentation = {
  gradient: string;
  iconClass: string;
};

const CARD_HIGHLIGHT =
  "radial-gradient(circle at 25% 15%, rgba(255, 255, 255, 0.12), transparent 55%)";

export const COURSE_CARD_PRESENTATION: Record<string, CourseCardPresentation> =
  {
    "system-yellow": {
      gradient: `${CARD_HIGHLIGHT}, linear-gradient(120deg, #FFE066 0%, #FFD633 50%, #FFCC00 100%)`,
      iconClass: "text-[#997A00]",
    },
    "system-red": {
      gradient: `${CARD_HIGHLIGHT}, linear-gradient(120deg, #FF9EA0 0%, #FF6B6E 50%, #FF383C 100%)`,
      iconClass: "text-[#D10004]",
    },
    "system-orange": {
      gradient: `${CARD_HIGHLIGHT}, linear-gradient(120deg, #FFC38E 0%, #FFA85B 50%, #FF8D28 100%)`,
      iconClass: "text-[#C15B00]",
    },
    "system-green": {
      gradient: `${CARD_HIGHLIGHT}, linear-gradient(120deg, #83DE9A 0%, #5AD479 50%, #34C759 100%)`,
      iconClass: "text-[#1F7635]",
    },
    "system-mint": {
      gradient: `${CARD_HIGHLIGHT}, linear-gradient(120deg, #2FFFE9 0%, #00FBE1 50%, #00C8B3 100%)`,
      iconClass: "text-[#006258]",
    },
    "system-teal": {
      gradient: `${CARD_HIGHLIGHT}, linear-gradient(120deg, #04EFFF 0%, #04EFFF 50%, #00C3D0 100%)`,
      iconClass: "text-[#00636A]",
    },
    "system-cyan": {
      gradient: `${CARD_HIGHLIGHT}, linear-gradient(120deg, #4FE1FF 0%, #1CD8FF 50%, #00C0E8 100%)`,
      iconClass: "text-[#006C82]",
    },
    "system-blue": {
      gradient: `${CARD_HIGHLIGHT}, linear-gradient(120deg, #66B8FF 0%, #33A0FF 50%, #0088FF 100%)`,
      iconClass: "text-[#005299]",
    },
    "system-indigo": {
      gradient: `${CARD_HIGHLIGHT}, linear-gradient(120deg, #BBB5FB 0%, #8E85F8 50%, #6155F5 100%)`,
      iconClass: "text-[#1C0DD7]",
    },
    "system-purple": {
      gradient: `${CARD_HIGHLIGHT}, linear-gradient(120deg, #E189ED 0%, #D65CE7 50%, #CB30E0 100%)`,
      iconClass: "text-[#851694]",
    },
    "system-pink": {
      gradient: `${CARD_HIGHLIGHT}, linear-gradient(120deg, #FF93A8 0%, #FF607E 50%, #FF2D55 100%)`,
      iconClass: "text-[#C60026]",
    },
    "system-brown": {
      gradient: `${CARD_HIGHLIGHT}, linear-gradient(120deg, #CFB5A1 0%, #BD9A80 50%, #AC7F5E 100%)`,
      iconClass: "text-[#6C4E38]",
    },
  };

export function getCourseCardPresentation(
  token: string | null | undefined,
): CourseCardPresentation | undefined {
  if (!token) return undefined;
  return COURSE_CARD_PRESENTATION[token];
}
