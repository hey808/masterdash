import { attachDispositions } from "@/lib/appointments";
import { todayET } from "@/lib/dates";
import { loadCalendar, type CalEvent } from "@/lib/ghl";
import { gridWindow, monthGrid, monthLabel, monthOf, shiftMonth } from "@/lib/month";
import Month from "./Month";

export const dynamic = "force-dynamic";
export const metadata = { title: "Calendar" };

const SHOW = { all: "Everything", sales: "Sales appointments", install: "Installs" } as const;
type Show = keyof typeof SHOW;
const LOCS = { all: "All locations", wilmington: "Wilmington", "myrtle-beach": "Myrtle Beach" } as const;
type Loc = keyof typeof LOCS;

export default async function CalendarPage({ searchParams }: { searchParams: { month?: string; day?: string; show?: string; loc?: string } }) {
  const today = todayET();
  const thisMonth = monthOf(today);
  const month = searchParams.month && /^\d{4}-\d{2}$/.test(searchParams.month) ? searchParams.month : thisMonth;
  const show: Show = searchParams.show && searchParams.show in SHOW ? (searchParams.show as Show) : "all";
  const loc: Loc = searchParams.loc && searchParams.loc in LOCS ? (searchParams.loc as Loc) : "all";
  const days = monthGrid(month);
  // The selected day: from the link if it's on this grid, else today (this month) or the 1st.
  const day = searchParams.day && days.includes(searchParams.day) ? searchParams.day : month === thisMonth ? today : `${month}-01`;
  const cal = await loadCalendar(...gridWindow(days));
  const problems = cal.problems;
  const events = await attachDispositions(cal.events);
  const shown = events.filter((e: CalEvent) => days.includes(e.day) && (show === "all" || e.kind === show) && (loc === "all" || e.location === loc));
  const inMonth = shown.filter((e) => e.day.startsWith(month) && e.status !== "cancelled");

  const href = (p: { month?: string; show?: Show; loc?: Loc }) => {
    const q = new URLSearchParams();
    const m = p.month ?? month;
    if (m !== thisMonth) q.set("month", m);
    if ((p.show ?? show) !== "all") q.set("show", p.show ?? show);
    if ((p.loc ?? loc) !== "all") q.set("loc", p.loc ?? loc);
    const s = q.toString();
    return s ? `/calendar?${s}` : "/calendar";
  };

  return (
    <>
      <div className="page-head">
        <h1>Calendar</h1>
        <div className="page-actions cal-weeknav">
          <a className="btn-ghost" href={href({ month: shiftMonth(month, -1) })} aria-label="Previous month">←</a>
          <span className="cal-range">{monthLabel(month)}</span>
          <a className="btn-ghost" href={href({ month: shiftMonth(month, 1) })} aria-label="Next month">→</a>
          {month !== thisMonth && <a className="btn-outline page-btn" href={href({ month: thisMonth })}>Today</a>}
        </div>
      </div>
      <div className="table-bar">
        <nav className="segmented" aria-label="Show">
          {(Object.keys(SHOW) as Show[]).map((s) => (
            <a key={s} href={href({ show: s })} className={s === show ? "on" : ""} aria-current={s === show ? "page" : undefined}>{SHOW[s]}</a>
          ))}
        </nav>
        <nav className="filters loc-pills" aria-label="Location">
          {(Object.keys(LOCS) as Loc[]).map((l) => (
            <a key={l} href={href({ loc: l })} className={l === loc ? "on" : ""}>{LOCS[l]}</a>
          ))}
        </nav>
        <span className="muted">
          {monthLabel(month)}: {inMonth.filter((e) => e.kind === "sales").length} sales appointments · {inMonth.filter((e) => e.kind === "install").length} installs
        </span>
      </div>
      {problems.length > 0 && (
        <ul className="report-flags">
          {problems.map((p, i) => <li key={i}>{p.location}: {p.message}</li>)}
        </ul>
      )}
      <Month month={month} days={days} events={shown} today={today} initialDay={day} />
    </>
  );
}
