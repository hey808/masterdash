import HomeCharts from "./HomeCharts";
import { attachDispositions } from "@/lib/appointments";
import { shortDate, todayET } from "@/lib/dates";
import { fmt } from "@/lib/money";
import { homeMetrics, type PersonStat } from "@/lib/reports";
import { frameRange, isFrame, type Frame } from "@/lib/timeframe";
import HomeFrame from "./HomeFrame";
import Month from "./calendar/Month";
import { loadCalendar } from "@/lib/ghl";
import { gridWindow, monthGrid, monthLabel, monthOf } from "@/lib/month";

export const dynamic = "force-dynamic";

const DEFAULT: Frame = "last30";

export default async function Home({ searchParams }: { searchParams: { frame?: string; from?: string; to?: string; day?: string } }) {
  const frame: Frame = isFrame(searchParams.frame) ? searchParams.frame : DEFAULT;
  const today = todayET();
  const [rf, rt] = frameRange(frame, today, searchParams.from, searchParams.to);
  const month = monthOf(today);
  const days = monthGrid(month);
  const [m, cal] = await Promise.all([homeMetrics(today, rf ?? "2000-01-01", rt ?? today), loadCalendar(...gridWindow(days))]);
  const gridEvents = await attachDispositions(cal.events.filter((e) => days.includes(e.day)));
  const todays = gridEvents.filter((e) => e.day === today && e.status !== "cancelled");
  const selected = searchParams.day && days.includes(searchParams.day) ? searchParams.day : today;
  const bankBehind = m.bankThrough != null && m.bankThrough < today;

  return (
    <>
      <h1>Home</h1>


      <div className="table-bar home-numbers first">
        <HomeFrame frame={frame} from={searchParams.from ?? ""} to={searchParams.to ?? ""} />
      </div>

      <div className="home-stats">
        <Big label="Revenue (sold)" value={fmt(m.soldCents)} href="/ledger" note={`${m.sold} deal${m.sold === 1 ? "" : "s"} sold: ${m.soldInstalled} installed, ${m.sold - m.soldInstalled} waiting on install`} />
        <Big label="Collected" value={fmt(m.collectedCents)} href="/ledger" note="Cash in during this period, any deal" flag={m.collectedUndated ? `${m.collectedUndated} imported payment${m.collectedUndated === 1 ? "" : "s"} dated by install day` : undefined} />
        <Big label="Accounts receivable" value={fmt(m.receivableCents)} href="/ledger?view=receivables" tone={m.receivableCents > 0 ? "due" : undefined} note={`Today, all time: ${m.receivableDeals} installed job${m.receivableDeals === 1 ? "" : "s"} with a balance`} />
        <Big label="Due after install" value={fmt(m.backlogDueCents)} href="/ledger" note={`Today, all time: ${m.backlogDeals} sold job${m.backlogDeals === 1 ? "" : "s"} not installed yet`} />
        <Big label="Expenses" value={fmt(m.expensesCents)} href="/reports" flag={bankBehind ? `Bank through ${shortDate(m.bankThrough)}` : m.bankThrough == null ? "Import bank statements" : undefined} />
      </div>

      <HomeCharts buckets={m.buckets} size={m.bucketSize} cashBuckets={m.cashBuckets} cashSize={m.cashBucketSize} pipeline={m.pipeline} />

      <section className="home-cal">
        <div className="home-cal-head">
          <h2 className="section">{monthLabel(month)}</h2>
          <span className="muted">
            Today: {todays.filter((e) => e.kind === "sales").length} sales appointments, {todays.filter((e) => e.kind === "install").length} installs
          </span>
          <a className="btn-outline page-btn" href="/calendar">Open calendar</a>
        </div>
        {cal.problems.length > 0 && (
          <ul className="report-flags">
            {cal.problems.map((p, i) => <li key={i}>{p.location}: {p.message}</li>)}
          </ul>
        )}
        <Month month={month} days={days} events={gridEvents} today={today} initialDay={selected} compact />
      </section>

      <div className="home-boards">
        <Board title="Top reps" rows={m.reps} unit="Sold" />
        <Board title="Top installers" rows={m.installers} unit="Installed" />
      </div>
    </>
  );
}

function Big({ label, value, href, tone, flag, note }: { label: string; value: string; href: string; tone?: "due"; flag?: string; note?: string }) {
  return (
    <a className={`big-stat ${tone ?? ""}`} href={href}>
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      {note && <span className="note">{note}</span>}
      {flag && <span className="flag">{flag}</span>}
    </a>
  );
}

function Board({ title, rows, unit }: { title: string; rows: PersonStat[]; unit: string }) {
  const top = rows[0]?.revenueCents ?? 0;
  return (
    <section className="board">
      <h2 className="section">{title}</h2>
      {rows.length === 0 ? (
        <p className="empty">Nothing in this period.</p>
      ) : (
        <table>
          <thead>
            <tr><th>#</th><th>Name</th><th className="num">{unit}</th><th className="num">Revenue</th><th className="num">Avg ticket</th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.name} className={r.name === "Unassigned" ? "muted" : ""}>
                <td className="muted">{i + 1}</td>
                <td>
                  <span className="board-name">{r.name}</span>
                  <span className="board-bar" style={{ width: `${top ? Math.max(2, (r.revenueCents / top) * 100) : 0}%` }} />
                </td>
                <td className="num">{r.deals}</td>
                <td className="num strong">{fmt(r.revenueCents)}</td>
                <td className="num">{fmt(r.avgCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
