import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, LegalSection, Todo } from "@/components/marketing/legal-page";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "SnapURL terms of service. Placeholder page: the legal text is pending the project maintainer.",
};

const REPO_URL = "https://github.com/DhananjayThomble/URL-Shortener-App";

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      intro="The terms that apply when you use SnapURL. This page is a placeholder while the maintainer writes them."
    >
      <LegalSection title="What is already documented">
        <p className="m-0">
          These points restate what the project already says elsewhere. They are not a substitute for terms.
        </p>
        <ul className="m-0 pl-5 list-disc flex flex-col gap-1.5">
          <li>
            The SnapURL source code is MIT licensed and available on{" "}
            <a href={REPO_URL} target="_blank" rel="noreferrer noopener" className="text-accent font-semibold">
              GitHub
            </a>
            .
          </li>
          <li>
            You can run SnapURL yourself; see <Link href="/self-host" className="text-accent font-semibold">self-hosting</Link>.
            If you do, you are the operator of your own install.
          </li>
          <li>
            The hosted service is currently free and the only thing it counts is clicks; see{" "}
            <Link href="/pricing" className="text-accent font-semibold">pricing</Link>.
          </li>
          <li>
            How click data and account data are handled is described on the{" "}
            <Link href="/privacy" className="text-accent font-semibold">privacy page</Link>.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Acceptance of the terms">
        <Todo>Say who the terms bind, when they take effect and how changes are announced.</Todo>
      </LegalSection>

      <LegalSection title="Your account">
        <Todo>Eligibility, accuracy of account details, responsibility for credentials and workspace members.</Todo>
      </LegalSection>

      <LegalSection title="Acceptable use of short links">
        <Todo>
          What may not be shortened or redirected to (malware, phishing, illegal content), and what happens when a link
          is flagged or reported.
        </Todo>
      </LegalSection>

      <LegalSection title="Availability, changes and termination">
        <Todo>Service availability, how the service or pricing may change, and how accounts and links are closed.</Todo>
      </LegalSection>

      <LegalSection title="Liability and warranty">
        <Todo>Warranty disclaimer and limits of liability. Needs legal review.</Todo>
      </LegalSection>

      <LegalSection title="Governing law and contact">
        <Todo>Governing law, jurisdiction and a contact address for legal notices.</Todo>
      </LegalSection>
    </LegalPage>
  );
}
