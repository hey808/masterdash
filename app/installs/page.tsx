import { installAppointments } from "@/lib/appointments";
import { currentSession } from "@/lib/auth";
import { todayET } from "@/lib/dates";
import { addDays } from "@/lib/ledger/payrun";
import InstallsView from "./InstallsView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Installs" };

const longDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

export default async function InstallsPage({ searchParams }: { searchParams: { day?: string } }) {
  const session = await currentSession();
  const today = todayET();
  const day = searchParams.day && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.day) ? searchParams.day : today;
  // An installer sees their own; the office sees everyone's.
  const mine = session && session.role !== "admin" ? session.personId : null;
  const { appointments, problems } = await installAppointments(day, mine);
  return (
    <div className="appts-page">
      <div className="appts-head">
        <a className="appts-nav" href={`/installs?day=${addDays(day, -1)}`} aria-label="Previous day">‹</a>
        <div>
          <h1>{day === today ? "Today's installs" : longDay(day)}</h1>
          <p className="muted">{day === today ? longDay(day) : <a href="/installs">Back to today</a>}</p>
        </div>
        <a className="appts-nav" href={`/installs?day=${addDays(day, 1)}`} aria-label="Next day">›</a>
      </div>
      {problems.length > 0 && <ul className="report-flags">{problems.map((p, i) => <li key={i}>{p.location}: {p.message}</li>)}</ul>}
      <InstallsView appointments={appointments} day={day} showWho={!mine} />
      <p className="appts-foot"><a href="/forms/install">Install not on the calendar? Open the installer form</a></p>
    </div>
  );
}
