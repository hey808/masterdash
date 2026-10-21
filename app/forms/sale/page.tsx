import { salesAppointments } from "@/lib/appointments";
import { todayET } from "@/lib/dates";
import { loadStock } from "@/lib/inventory";
import { currentSession } from "@/lib/auth";
import { loadOptions } from "@/lib/ledger/options";
import SaleForm from "./SaleForm";

export const dynamic = "force-dynamic";

export default async function SaleFormPage({ searchParams }: { searchParams: { appt?: string; day?: string } }) {
  const session = await currentSession();
  // Reps and installers submit as themselves; the API enforces it too.
  const me = session && session.role !== "admin" && session.personId ? { personId: session.personId, name: session.name } : null;
  const today = todayET();
  // Opened from an appointment marked Closed: that appointment's day, that appointment.
  const day = searchParams.day && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.day) && searchParams.day <= today ? searchParams.day : today;
  const [options, appts] = await Promise.all([
    loadOptions(),
    // A rep sees their own appointments; the office sees everyone's.
    salesAppointments(day, me?.personId ?? null).catch(() => ({ appointments: [], problems: [{ location: "GoHighLevel", message: "couldn't load today's appointments" }] })),
  ]);
  const apptNote =
    appts.appointments.length === 0
      ? appts.problems.length
        ? `Couldn't load today's appointments (${appts.problems.map((p) => `${p.location}: ${p.message}`).join("; ")}). Enter the customer by hand.`
        : `No sales appointments on ${me ? "your" : "the"} calendar today. Enter the customer by hand.`
      : null;
  const open = options.locations.filter((l) => l.active);
  const stock: Record<string, Record<string, number>> = {};
  for (const l of open) {
    stock[l.slug] = Object.fromEntries((await loadStock(l.slug)).map((r) => [r.skuCode, r.available]));
  }
  return (
    <>
      <p className="crumb"><a href="/forms">Forms</a> / Sales form</p>
      <h1>Sales form</h1>
      <SaleForm options={options} stock={stock} today={today} me={me} appointments={appts.appointments} apptNote={apptNote} initialAppt={searchParams.appt} />
    </>
  );
}
