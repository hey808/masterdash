import { notFound } from "next/navigation";
import { currentSession } from "@/lib/auth";
import { loadCustomer } from "@/lib/customers";
import { todayET } from "@/lib/dates";
import CustomerProfileView from "../CustomerProfileView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Customer" };

export default async function CustomerPage({ params }: { params: { key: string } }) {
  const s = await currentSession();
  if (!s) notFound();
  const p = await loadCustomer(params.key, { role: s.role, personId: s.personId }, todayET());
  if (!p) notFound();
  return (
    <div className="cust-page">
      <p className="crumb"><a href="/customers">Customers</a> / {p.name}</p>
      <CustomerProfileView p={p} />
    </div>
  );
}
