import {
  LegalDocument,
  LegalList,
  LegalParagraphs,
  type LegalSection,
} from "@/components/landing/legal-document";
import { LEGAL_CONTACT_EMAIL, LEGAL_ENTITY_NAME } from "@/lib/legal";

/**
 * Public privacy policy.
 *
 * The "what we collect" and "service providers" sections are written from the
 * real schema in `docs/DATA-MODEL.md` and the real deployment in
 * `docs/ARCHITECTURE.md`, not from a generic template — a policy that overstates
 * or understates what is stored is worse than none. When a table, column, or
 * subprocessor changes, this page changes with it.
 */
export default function PrivacyPage() {
  const sections: readonly LegalSection[] = [
    {
      id: "who-we-are",
      heading: "Who we are",
      body: (
        <LegalParagraphs
          paragraphs={[
            `${LEGAL_ENTITY_NAME} ("we", "us") operates the Deadline Radar website and application (the "Service"). This policy explains what personal data we collect, why we collect it, who we share it with, and what rights you have over it.`,
            "The Service is designed for individual students managing their own coursework. It is not a shared workspace: your courses, tasks, and attachments are visible only to you.",
          ]}
        />
      ),
    },
    {
      id: "information-we-collect",
      heading: "Information we collect",
      body: (
        <>
          <p>
            <strong className="font-semibold text-ink">
              Account information you give us.
            </strong>{" "}
            An email address and password when you register, a display name, and
            a timezone. The password is hashed by our authentication provider
            and we never receive it in a form we could read back.
          </p>
          <p>
            <strong className="font-semibold text-ink">
              Coursework data you create.
            </strong>{" "}
            The courses you add (name, optional code, colour, icon, and
            description), the tasks you create (title, description, deadline,
            status, and completion time), and the reminder thresholds you
            configure for each task. Deleting a course or task removes it
            together with everything attached to it.
          </p>
          <p>
            <strong className="font-semibold text-ink">Attachments.</strong>{" "}
            Files you upload to a task are stored in our file storage and are
            associated with that task. You can instead save a link, in which case
            we store only the URL and a note. We do not open, index, or read the
            contents of your files.
          </p>
          <p>
            <strong className="font-semibold text-ink">
              Notification records.
            </strong>{" "}
            When a reminder is due we record which task and threshold triggered
            it, the channel used, whether it was delivered, the time it was
            sent, and whether you have read it. This exists so a reminder is not
            sent twice and so you can see what has already been sent.
          </p>
          <p>
            <strong className="font-semibold text-ink">
              Security and technical records.
            </strong>{" "}
            We keep an append-only log of authentication events (sign-in,
            sign-out, password change, failed attempts) together with the IP
            address and time of each, retained for 90 days. We also process
            your IP address to rate-limit requests and throttle repeated failed
            sign-in attempts.
          </p>
        </>
      ),
    },
    {
      id: "how-we-use-it",
      heading: "How we use your information",
      body: (
        <LegalList
          items={[
            "To run the Service: showing you your courses, tasks, calendar, and reminders to the account you signed in with.",
            "To send the email reminders you asked for, at the offsets you configured.",
            "To keep your account secure: detecting brute-force sign-in attempts, invalidating sessions after a password change, and auditing access to your data.",
            "To understand aggregate usage and fix errors, so the Service keeps working.",
          ]}
        />
      ),
    },
    {
      id: "reminder-email",
      heading: "Reminder email",
      body: (
        <LegalParagraphs
          paragraphs={[
            "Reminder email is opt-in. We send an email only for thresholds you have enabled yourself, to the address on your account, from the address shown on the reminder. Every reminder names the task and the date it refers to.",
            "You can change, disable, or remove reminder thresholds at any time in the app, and change the sending address or turn reminders off entirely under Settings. Turning them off stops new email immediately; it does not recall email already handed to our delivery provider.",
          ]}
        />
      ),
    },
    {
      id: "service-providers",
      heading: "Service providers",
      body: (
        <>
          <p>
            We do not sell your personal data. We use a small number of
            processors that host the Service or deliver its emails, and they act
            on our instructions:
          </p>
          <LegalList
            items={[
              "Supabase — authentication, the database, and file storage.",
              "Resend — transactional delivery of reminder email.",
              "Redis — request rate limiting and sign-in throttling.",
              "Sentry — optional error reporting. If it is not configured for a deployment, no diagnostic data leaves that deployment.",
            ]}
          />
          <p>
            Each of these processes data only to provide its function to us. If
            we add a processor, we will list it here.
          </p>
        </>
      ),
    },
    {
      id: "how-we-protect-it",
      heading: "How we protect it",
      body: (
        <LegalParagraphs
        paragraphs={[
            "All traffic is encrypted in transit. Passwords are hashed, not stored. Data is isolated per account at the database layer, so a request is only served for the account that owns it, and reminder scheduling runs under a private internal credential rather than a public endpoint.",
            "No system is perfectly secure. If a breach affects your personal data we will notify you and the relevant regulator as required by law.",
          ]}
        />
      ),
    },
    {
      id: "retention-and-deletion",
      heading: "Retention and deletion",
      body: (
        <LegalList
          items={[
            "Your courses, tasks, reminder thresholds, attachments, and notification records are kept for as long as your account exists.",
            "Authentication audit records are kept for 90 days, then purged.",
            "Deleting your account deletes your profile and, by cascade, your courses, tasks, attachments, and notification records.",
            "Deletion of a single course or task removes it and its dependent records immediately; it cannot be undone from the app.",
          ]}
        />
      ),
    },
    {
      id: "your-rights",
      heading: "Your rights",
      body: (
        <LegalParagraphs
          paragraphs={[
            "Depending on where you live you may have the right to access, correct, export, or delete your personal data, to object to or restrict processing, and to complain to a supervisory authority. You can correct your name, email address, and timezone, and delete your data, directly in the app without contacting us.",
            `For anything else, write to ${LEGAL_CONTACT_EMAIL}. We will verify that the request comes from the account it concerns before acting on it.`,
          ]}
        />
      ),
    },
    {
      id: "international-transfers",
      heading: "International transfers",
      body: (
        <LegalParagraphs
          paragraphs={[
            "Our processors may store or process data outside your country, including in the United States and Australia. Where a transfer is not covered by an adequacy decision, we rely on standard contractual protections. Contact us for a copy.",
          ]}
        />
      ),
    },
    {
      id: "childrens-data",
      heading: "Children's data",
      body: (
        <LegalParagraphs
          paragraphs={[
            "The Service is not directed at children under 13 and we do not knowingly collect their personal data. If you believe a child has given us personal data, contact us and we will delete it.",
          ]}
        />
      ),
    },
    {
      id: "changes-to-this-policy",
      heading: "Changes to this policy",
      body: (
        <LegalParagraphs
          paragraphs={[
            "We will update this page when our practices change, and revise the effective date above. If a change materially reduces your rights we will tell you by email before it takes effect. Continuing to use the Service after a change means you accept the updated policy.",
          ]}
        />
      ),
    },
    {
      id: "contact",
      heading: "Contact",
      body: (
        <LegalParagraphs
          paragraphs={[
            `Questions about this policy, or about our handling of your data, go to ${LEGAL_CONTACT_EMAIL}.`,
          ]}
        />
      ),
    },
  ];

  return (
    <LegalDocument
      title="Privacy Policy"
      summary={
        <p>
          This policy describes what {LEGAL_ENTITY_NAME} collects when you use
          Deadline Radar, why we collect it, and the choices you have. We
          collect the account details you give us, the coursework you create, and
          the technical records needed to keep your account secure. We do not
          sell your data.
        </p>
      }
      sections={sections}
    />
  );
}
