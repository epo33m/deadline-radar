import { Resend } from "resend";

import { urgencyLabel } from "@/lib/reminders/urgency";

export type ReminderEmailPayload = {
  to: string;
  taskTitle: string;
  daysBefore: number;
  deadlineIso: string;
};

function formatDeadlineForEmail(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
}

/** Send a single reminder email via Resend. Throws on API failure. */
export async function sendReminderEmail(
  payload: ReminderEmailPayload,
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("Missing RESEND_API_KEY.");
  }

  const from =
    process.env.RESEND_FROM_EMAIL ?? "Deadline Radar <onboarding@resend.dev>";
  const label = urgencyLabel(payload.daysBefore);
  const resend = new Resend(apiKey);

  const { error } = await resend.emails.send({
    from,
    to: payload.to,
    subject: `[${label}] Reminder: ${payload.taskTitle}`,
    text: [
      `Reminder (${label})`,
      "",
      `Task: ${payload.taskTitle}`,
      `Deadline: ${formatDeadlineForEmail(payload.deadlineIso)} (UTC)`,
      "",
      "— Deadline Radar",
    ].join("\n"),
  });

  if (error) {
    throw new Error(error.message);
  }
}
