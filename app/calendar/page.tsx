import { todayET } from "@/lib/dates";
import { loadCalendar, type CalEvent } from "@/lib/ghl";
import { addDays } from "@/lib/ledger/payrun";
import { mondayOf, weekDays, weekWindow } from "@/lib/week";
import Week from "./Week";

export const dynamic = "force-dynamic";
export const metadata = { title: "Calendar" };

const SHOW = { all: "Everything", sales: "Sales appointments", install: "Installs" } as const;
type Show = keyof typeof SHOW;
const LOCS = { all: "All locations", wilmington: "Wilmington", "myrtle-beach": "Myrtle Beach" } as const;
type Loc = keyof typeof LOCS;

const label = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export default async function CalendarPage({ searchParams }: { searchParams: { week?: string; show?: string; loc?: string } }) {
  const today = todayET();
  const thisMonday = mondayOf(today);
  const monday = searchParams.week && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.week) ? mondayOf(searchParams.week) : thisMonday;
  const show: Show = searchParams.show && searchParams.show in SHOW ? (searchParams.show as Show) : "all";
  const loc: Loc = searchParams.loc && searchParams.loc in LOCS ? (searchParams.loc as Loc) : "all";
  const days = weekDays(monday);
  const [from, to] = weekWindow(monday);
  const { events, problems } = await loadCalendar(from, to);
  const shown = events.filter((e: CalEvent) => days.includes(e.day) && (show === "all" || e.kind === show) && (loc === "all" || e.location === loc));
  const counts = { sales: shown.filter((e) => e.kind === "sales" && e.status !== "cancelled").length, install: shown.filter((e) => e.kind === "install" && e.status !== "cancelled").length };

  const href = (p: { week?: string; show?: Show; loc?: Loc }) => {
    const q = new URLSearchParams();
    const w = p.week ?? monday;
    if (w !== thisMonday) q.set("week", w);
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
          <a className="btn-ghost" href={href({ week: addDays(monday, -7) })} aria-label="Previous week">←</a>
          <span className="cal-range">{label(days[0]!)} to {label(days[6]!)}</span>
          <a className="btn-ghost" href={href({ week: addDays(monday, 7) })} aria-label="Next week">→</a>
          {monday !== thisMonday && <a className="btn-outline page-btn" href={href({ week: thisMonday })}>This week</a>}
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
        <span className="muted">{counts.sales} sales appointments · {counts.install} installs</span>
      </div>
      {problems.length > 0 && (
        <ul className="report-flags">
          {problems.map((p, i) => <li key={i}>{p.location}: {p.message}</li>)}
        </ul>
      )}
      <Week days={days} events={shown} today={today} />
    </>
  );
}
