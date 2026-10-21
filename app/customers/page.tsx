import { currentSession } from "@/lib/auth";
import { listCustomers } from "@/lib/customers";
import { todayET } from "@/lib/dates";
import CustomerList from "./CustomerList";

export const dynamic = "force-dynamic";
export const metadata = { title: "Customers" };

export default async function CustomersPage() {
  const s = await currentSession();
  const rows = s ? await listCustomers({ role: s.role, personId: s.personId }, todayET()) : [];
  return (
    <div className="agr-page">
      <div className="page-head">
        <h1>Customers</h1>
        <div className="page-actions"><a className="btn-primary page-btn" href="/agreements/new">+ New agreement</a></div>
      </div>
      <CustomerList rows={rows} showCloser={s?.role === "admin"} />
    </div>
  );
}
