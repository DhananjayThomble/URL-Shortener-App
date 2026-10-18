import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, LegalSection, Todo } from "@/components/marketing/legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "SnapURL privacy policy. Placeholder page: the legal text is pending the project maintainer.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro="What SnapURL collects and why. This page is a placeholder while the maintainer writes the policy; the facts below are the ones the project already documents."
    >
      <LegalSection title="Click analytics (already documented)">
        <p className="m-0">
          The following describes how the product is built today. See{" "}
          <Link href="/product#analytics" className="text-accent font-semibold">how analytics work</Link>.
        </p>
        <ul className="m-0 pl-5 list-disc flex flex-col gap-1.5">
          <li>Click analytics are cookieless. Nothing is stored on the visitor&apos;s device.</li>
          <li>
            Unique visitors are counted with a hash that rotates daily and resets at 00:00 UTC, so a returning visitor on
            a new day counts again.
          </li>
          <li>No IP address is stored.</li>
          <li>
            City comes from a CDN edge header as a name only, never a latitude or longitude. A city with fewer than five
            clicks in the window is folded into &ldquo;Other cities&rdquo;.
          </li>
          <li>The product does not add third-party tracking pixels to redirects.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Retention (already documented)">
        <ul className="m-0 pl-5 list-disc flex flex-col gap-1.5">
          <li>
            Raw click rows are kept for the workspace&apos;s &ldquo;Click data retention&rdquo; setting (1 year, 3 years or
            forever), capped by the install&apos;s own maximum (3 years by default). Rows can survive up to a day past the
            setting because they expire a whole day at a time.
          </li>
          <li>The aggregated rollups behind the dashboards are kept regardless of that setting.</li>
        </ul>
        <Todo>Confirm these retention statements and add retention for account data and deleted links.</Todo>
      </LegalSection>

      <LegalSection title="Self-hosting (already documented)">
        <p className="m-0">
          If you <Link href="/self-host" className="text-accent font-semibold">run SnapURL yourself</Link>, your database
          and backups are yours and the operator of that install decides retention within the limits above.
        </p>
        <Todo>Say how this policy relates to self-hosted installs run by someone else.</Todo>
      </LegalSection>

      <LegalSection title="Account data">
        <Todo>
          What is collected when you register (name, email, password hash, optional two-factor and sign-in provider
          data), the purpose, and the legal basis.
        </Todo>
      </LegalSection>

      <LegalSection title="Link scanning and other processors">
        <Todo>
          List any third parties that receive data (for example optional destination scanning with Google Safe
          Browsing, mail delivery, hosting) and what they receive.
        </Todo>
      </LegalSection>

      <LegalSection title="Your rights, export and deletion">
        <Todo>How to export or delete your data, and how to make a privacy request.</Todo>
      </LegalSection>

      <LegalSection title="Changes and contact">
        <Todo>How policy changes are announced, and a privacy contact address.</Todo>
      </LegalSection>
    </LegalPage>
  );
}
