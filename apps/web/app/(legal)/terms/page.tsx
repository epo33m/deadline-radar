import {
  LegalDocument,
  LegalList,
  LegalParagraphs,
  type LegalSection,
} from "@/components/landing/legal-document";
import { LEGAL_CONTACT_EMAIL, LEGAL_ENTITY_NAME } from "@/lib/legal";

/**
 * Public terms of service.
 *
 * Scoped to what the Service actually does: a single-user coursework tracker
 * that sends reminder email. There is no paid tier, no seat transfer, and no
 * marketplace in the product, so none of those clauses appear — a terms page
 * padded with obligations the product cannot create is not "comprehensive", it
 * is noise.
 */
export default function TermsPage() {
  const sections: readonly LegalSection[] = [
    {
      id: "agreement",
      heading: "Agreement",
      body: (
        <LegalParagraphs
          paragraphs={[
            `These terms govern your use of the Deadline Radar website and application (the "Service"), operated by ${LEGAL_ENTITY_NAME}. By creating an account or using the Service you accept them. If you do not accept them, do not use the Service.`,
            "These terms are a summary written in plain language. Where summary and law must agree, the summary is an accurate reflection of our commitments rather than a substitute for a signed agreement.",
          ]}
        />
      ),
    },
    {
      id: "your-account",
      heading: "Your account",
      body: (
        <>
          <LegalList
            items={[
              "You must be at least 13 years old to hold an account.",
              "You are responsible for the accuracy of your account details and for keeping your password confidential. Tell us promptly if you suspect someone else has used your account.",
              "You may change your email address and password from Settings. Changing your password invalidates your other sessions.",
              "One person, one account. There are no shared or team accounts in the Service.",
            ]}
          />
          <p>
            We may suspend or close an account that is used to attack the
            Service, to circumvent its limits, or to infringe the rights of
            others.
          </p>
        </>
      ),
    },
    {
      id: "your-content",
      heading: "Your content",
      body: (
        <LegalParagraphs
        paragraphs={[
            "You keep all rights to the courses, tasks, notes, and files you put in the Service. We claim no ownership of your coursework.",
            "You grant us only the narrow licence needed to operate the Service for you: to store, back up, transmit, and display your content to you and to send the reminders you configured. That licence ends when you delete the content or close your account.",
            "You are responsible for having the right to upload anything you attach, and for what is in it. Do not attach anything confidential to your employer or institution unless you are permitted to.",
          ]}
        />
      ),
    },
    {
      id: "acceptable-use",
      heading: "Acceptable use",
      body: (
        <LegalParagraphs
          paragraphs={[
            "Do not use the Service to break the law, to infringe anyone else's rights, to send unsolicited bulk email, to probe or overload the Service's infrastructure, or to circumvent the rate limits and throttles that protect it for everyone else. We may apply limits to keep the Service available.",
          ]}
        />
      ),
    },
    {
      id: "third-party-services",
      heading: "Third-party services",
      body: (
        <LegalParagraphs
          paragraphs={[
            "The Service depends on third-party providers for hosting, authentication, storage, and email delivery. They are described in the Privacy Policy. Their services are provided under their own terms, and we are not responsible for them.",
          ]}
        />
      ),
    },
    {
      id: "our-ip",
      heading: "Our intellectual property",
      body: (
        <LegalParagraphs
          paragraphs={[
            `The Service — its software, design, and the ${LEGAL_ENTITY_NAME} name and marks — belongs to us. These terms grant you no rights to it beyond the right to use the Service as intended.`,
          ]}
        />
      ),
    },
    {
      id: "disclaimers",
      heading: "Disclaimers",
      body: (
        <>
          <LegalParagraphs
            paragraphs={[
              "The Service is provided \"as is\". We do not warrant that it will be uninterrupted, error-free, or fit for any particular purpose.",
              "Deadline Radar helps you remember deadlines. It is not a registrar, an official record of what is due, or a substitute for your institution's own systems. We are not responsible for a missed deadline caused by a reminder that did not arrive, was misconfigured, or was filtered by your mail provider.",
            ]}
          />
        </>
      ),
    },
    {
      id: "liability",
      heading: "Limitation of liability",
      body: (
        <LegalParagraphs
          paragraphs={[
            "To the extent permitted by law, we are not liable for indirect, incidental, special, or consequential loss, or for lost coursework, lost grades, or lost fees. Our total liability to you for any claim arising from the Service is limited to the greater of the amount you paid us in the twelve months before the claim or fifty dollars.",
            "Nothing in these terms limits liability that cannot be limited by law, including for fraud or wilful misconduct.",
          ]}
        />
      ),
    },
    {
      id: "termination",
      heading: "Termination",
      body: (
        <LegalParagraphs
          paragraphs={[
            "You can close your account at any time. We may suspend or terminate your access for breach of these terms, and will tell you why unless doing so would compromise the Service's security. On termination your data is deleted under the retention rules in the Privacy Policy.",
          ]}
        />
      ),
    },
    {
      id: "changes",
      heading: "Changes to these terms",
      body: (
        <LegalParagraphs
          paragraphs={[
            "We may update these terms, and will revise the effective date above. If a change materially reduces your rights we will tell you by email before it takes effect. Continuing to use the Service after a change means you accept the updated terms.",
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
            `Questions about these terms go to ${LEGAL_CONTACT_EMAIL}.`,
          ]}
        />
      ),
    },
  ];

  return (
    <LegalDocument
      title="Terms of Service"
      summary={
        <p>
          These terms cover your use of Deadline Radar. You keep ownership of
          everything you put in it; we run the service that stores it and sends
          the reminders you set up. The Service is a reminder aid, not an
          official record of what is due.
        </p>
      }
      sections={sections}
    />
  );
}
