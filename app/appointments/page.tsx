import { salesAppointments } from "@/lib/appointments";
import { currentSession } from "@/lib/auth";
import { todayET } from "@/lib/dates";
import { addDays } from "@/lib/ledger/payrun";
import AppointmentsView from "./AppointmentsView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Appointments" };

const longDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

export default async function AppointmentsPage({ searchParams }: { searchParams: { day?: string } }) {
  const session = await currentSession();
  const today = todayET();
  const day = searchParams.day && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.day) ? searchParams.day : today;
  // A rep sees their own; the office sees everyone's.
  const rep = session && session.role !== "admin" ? session.personId : null;
  const { appointments, problems } = await salesAppointments(day, rep);
  const prev = addDays(day, -1);
  const next = addDays(day, 1);
  return (
    <div className="appts-page">
      <div className="appts-head">
        <a className="appts-nav" href={`/appointments?day=${prev}`} aria-label="Previous day">‹</a>
        <div>
          <h1>{day === today ? "Today" : longDay(day)}</h1>
          <p className="muted">{day === today ? longDay(day) : <a href="/appointments">Back to today</a>}</p>
        </div>
        <a className="appts-nav" href={`/appointments?day=${next}`} aria-label="Next day">›</a>
      </div>
      {problems.length > 0 && <ul className="report-flags">{problems.map((p, i) => <li key={i}>{p.location}: {p.message}</li>)}</ul>}
      <AppointmentsView appointments={appointments} day={day} showRep={!rep} />
      <p className="appts-foot">
        <a href="/forms/sale">Sale not on the calendar? Open the sales form</a>
      </p>
    </div>
  );
}
