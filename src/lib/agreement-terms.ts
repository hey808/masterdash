/**
 * What goes on every customer agreement: who we are and the terms. Each
 * agreement stores the terms text it was created with (terms_version /
 * terms_text), so editing this file never changes an agreement already sent.
 * Shared with the browser: no server imports.
 */
export const COMPANY = {
  name: "Clearflow Water USA",
  legalName: "Clear Flow Water Company LLC",
  address: "1631 Hwy 544 Suite 2, Conway SC 29526",
  phone: "(843) 796-0893",
  email: "clearflowwaterco@gmail.com",
  web: "www.clearflowsc.com",
  cancelAddress: "621 Merrywood Road, Conway SC 29526",
};

export const SYSTEMS = ["Water Softener", "Reverse Osmosis", "Whole House Filter", "UV System", "Iron Filter"] as const;
export const SOAP_PACKAGES = { none: "None", basic: "Basic", standard: "Standard", premium: "Premium" } as const;
export type SoapPackage = keyof typeof SOAP_PACKAGES;
export const MAINTENANCE_PLAN = { name: "Annual General Maintenance Plan", detail: "One scheduled service visit per year", priceCents: 30000 };

export const TERMS_VERSION = "2026-10-21";

export interface TermsSection {
  heading: string;
  intro?: string;
  items: Array<{ title?: string; text: string }>;
}

export const TERMS: TermsSection[] = [
  {
    heading: "Customer agreement",
    intro:
      "This agreement confirms the purchase and installation of the water treatment system(s) listed. The total price includes all equipment, standard installation, required fittings/parts, labor, system set-up, and final operational testing. Customer acknowledges that any non-standard plumbing repairs or modifications (if needed) will be communicated before installation and may require a written change order.",
    items: [],
  },
  {
    heading: "Terms & conditions",
    items: [
      { title: "Scope of Work", text: "Company will provide the equipment, installation, and/or services as selected. Additional work may require a separate agreement." },
      { title: "Payment & Financing", text: "A deposit may be required at time of order. Balance due upon completion." },
      { title: "Warranty", text: "Manufacturer's limited lifetime warranty applies. Workmanship covered by the limited lifetime warranty. Misuse, neglect, or lack of maintenance not covered." },
      {
        title: "Service & Maintenance",
        text: "The Annual General Maintenance Plan ($300/year) includes one scheduled visit per year by a Clear Flow technician. This visit covers full system inspection, filter/media check, system flush, calibration, and performance testing. Additional visits outside the plan may incur service charges. Note: 4 bags of salt are included at initial system installation.",
      },
      { title: "Limitation of Liability", text: "Company not liable for indirect, incidental, or consequential damages. Remedy limited to repair, replacement, or refund at Company's discretion." },
      { title: "Acts of God & Force Majeure", text: "Company not liable for delays or failures due to events beyond control (natural disasters, severe weather, pandemics, etc.)." },
      { title: "Jurisdiction & Governing Law", text: "Agreement governed by the laws of the installation state. Disputes resolved in courts of that state and county." },
      { title: "Entire Agreement", text: "This Agreement and the Order Form constitute the full agreement. Changes must be in writing." },
      { title: "Severability", text: "If any provision is invalid, the remainder stays in effect." },
      { title: "Acceptance", text: "By signing the Order Form, Customer agrees to these Terms & Conditions." },
    ],
  },
  {
    heading: "Cancellation & right to rescind",
    items: [
      {
        title: "Three-Day Right to Cancel (Rescission)",
        text: "You, the customer, have the unconditional right to cancel this transaction without penalty or obligation within three (3) business days from the date of this agreement. To cancel within this three-day period, you must notify Clear Flow Water Company in writing (mail, email, or hand delivery) by midnight of the third business day following the date of this agreement. If you cancel during this three-day rescission period, you will receive a full refund of any payments made.",
      },
      {
        title: "Cancellation After Three-Day Rescission Period",
        text: "If you choose to cancel after the three (3) business day rescission period has expired, Clear Flow Water Company LLC. reserves the right to charge a $500 cancellation/restocking fee. This fee covers administrative costs, scheduling, and restocking of ordered equipment. The cancellation/restocking fee will be deducted from any refund due.",
      },
      {
        title: "How to Cancel",
        text: `To cancel, send notice to Clear Flow Water Company LLC., ${COMPANY.cancelAddress}. Written notice must clearly state your request to cancel and include your name, address, and the date of the agreement.`,
      },
    ],
  },
  {
    heading: "Disclaimer",
    items: [{ text: "All equipment carries the manufacturer's warranty. Installation is subject to site inspection and may require additional modifications at extra cost." }],
  },
];

export const ACKNOWLEDGEMENT =
  "By signing below, the customer confirms they have read this agreement in full, including the terms and conditions and the right-to-cancel notice, and agrees to purchase the equipment and services listed at the price shown.";

export const ESIGN_CONSENT = "I agree to sign this agreement electronically, and I understand my electronic signature is legally binding, the same as signing on paper.";

/** The terms as one stored text block (what the customer signed). */
export const termsText = (): string =>
  TERMS.map((s) => [s.heading.toUpperCase(), s.intro ?? "", ...s.items.map((it, i) => `${s.items.length > 1 ? `${i + 1}. ` : ""}${it.title ? `${it.title}. ` : ""}${it.text}`)].filter(Boolean).join("\n")).join("\n\n");

/** "Brock Calhoun" → "BC". */
export const initialsOf = (name: string | null | undefined) =>
  (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .slice(0, 3)
    .join("");
