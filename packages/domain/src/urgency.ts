/** Urgency label for reminder emails / in-app copy (ARCHITECTURE.md §2.5). */
export function urgencyLabel(daysBefore: number): string {
  if (daysBefore === 0) return "H-0 — today!";
  return `H-${daysBefore}`;
}
