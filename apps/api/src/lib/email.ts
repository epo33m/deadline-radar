import { urgencyLabel } from "@deadline-radar/domain";
import { Resend } from "resend";

import { env } from "../env";

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

export async function sendReminderEmail(
  payload: ReminderEmailPayload,
): Promise<void> {
  const apiKey = env.resendApiKey();
  if (!apiKey) {
    throw new Error("Missing RESEND_API_KEY.");
  }

  const resend = new Resend(apiKey);
  const label = urgencyLabel(payload.daysBefore);

  const { error } = await resend.emails.send({
    from: env.resendFromEmail,
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
