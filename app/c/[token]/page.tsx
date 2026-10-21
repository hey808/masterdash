import { notFound } from "next/navigation";
import { COMPANY } from "@/lib/agreement-terms";
import { loadAgreementByToken } from "@/lib/agreements";
import SignAgreement from "./SignAgreement";

export const dynamic = "force-dynamic";
export const metadata = { title: `Your agreement · ${COMPANY.name}`, robots: { index: false, follow: false } };

/** Public: the customer's agreement, opened by its secret link. */
export default async function CustomerAgreementPage({ params }: { params: { token: string } }) {
  const a = await loadAgreementByToken(params.token);
  if (!a) notFound();
  // Only what the customer needs; nothing internal (no ids, deal numbers or the signing record).
  const view = {
    token: params.token,
    number: a.number,
    status: a.status,
    createdAt: a.createdAt,
    repName: a.repName,
    repInitials: a.repInitials,
    firstName: a.firstName,
    lastName: a.lastName,
    address: a.address,
    unit: a.unit,
    city: a.city,
    state: a.state,
    zip: a.zip,
    phone: a.phone,
    phone2: a.phone2,
    email: a.email,
    hardness: a.hardness,
    systems: a.systems,
    equipment: a.equipment,
    soapPackage: a.soapPackage,
    maintenancePlan: a.maintenancePlan,
    priceCents: a.priceCents,
    financedCents: a.financedCents,
    lender: a.lender,
    depositCents: a.depositCents,
    depositMethod: a.depositMethod,
    installDate: a.installDate,
    notes: a.notes,
    installerNotes: a.installerNotes,
    signedAt: a.signedAt,
  };
  return <SignAgreement a={view} />;
}
