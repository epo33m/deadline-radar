/**
 * Legal copy constants, read by the footer and by the `/privacy` and `/terms`
 * pages so there is a single point of edit.
 *
 * The operating entity behind Deadline Radar is not recorded anywhere in this
 * repo, so these are placeholders. `LEGAL_CONTACT_EMAIL` deliberately uses the
 * reserved `.example` TLD (RFC 2606) so a forgotten placeholder can never reach
 * a real mailbox. Replace all three with the real entity name, contact address,
 * and effective date before this ships.
 */

export const LEGAL_ENTITY_NAME = "Deadline Radar";

export const LEGAL_CONTACT_EMAIL = "privacy@deadlineradar.example";

export const LEGAL_EFFECTIVE_DATE = "September 28, 2026";

/** The footer's legal row. Both targets are real routes. */
export const LEGAL_LINKS = [
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms of Service" },
] as const;
