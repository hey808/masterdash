import { todayET } from "@/lib/dates";
import { db } from "@/lib/db";
import { currentSession } from "@/lib/auth";
import { loadOptions } from "@/lib/ledger/options";
import InstallForm, { type OpenJob } from "./InstallForm";

export const dynamic = "force-dynamic";

/** Only existing, not-yet-installed, live deals can be picked. */
async function openJobs(): Promise<OpenJob[]> {
  const { rows } = await db().query(
    `select d.id, d.number, d.customer_name, d.customer_address, d.install_scheduled_on, l.name as location,
       coalesce((select string_agg(case when x.qty > 1 then x.qty || '× ' || x.sku_code else x.sku_code end, ' + ' order by x.sort)
                 from deal_lines x where x.deal_id = d.id), '') as products
     from deals d join locations l on l.id = d.location_id
     where d.installed_on is null and d.cancelled_at is null
     order by d.install_scheduled_on nulls last, d.number desc`,
  );
  return rows.map((r) => ({
    id: r.id, number: Number(r.number), customer: r.customer_name, address: r.customer_address, scheduled: r.install_scheduled_on,
    location: r.location, products: r.products,
  }));
}

export default async function InstallFormPage() {
  const session = await currentSession();
  // Reps and installers submit as themselves; the API enforces it too.
  const me = session && session.role !== "admin" && session.personId ? { personId: session.personId, name: session.name } : null;
  const [options, jobs] = await Promise.all([loadOptions(), openJobs()]);
  return (
    <>
      <p className="crumb"><a href="/forms">Forms</a> / Installer form</p>
      <h1>Installer form</h1>
      <InstallForm jobs={jobs} people={options.people} today={todayET()} me={me} />
    </>
  );
}
