import { shortDate, todayET } from "@/lib/dates";
import { salesDashboard } from "@/lib/dashboards";
import { fmt } from "@/lib/money";
import { frameRange, isFrame, type Frame } from "@/lib/timeframe";
import HomeFrame from "../HomeFrame";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sales" };

const pct = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)}%`);

export default async function SalesPage({ searchParams }: { searchParams: { frame?: string; from?: string; to?: string } }) {
  const frame: Frame = isFrame(searchParams.frame) ? searchParams.frame : "thisMonth";
  const today = todayET();
  const [rf, rt] = frameRange(frame, today, searchParams.from, searchParams.to);
  const s = await salesDashboard(today, rf ?? "2000-01-01", rt ?? today);
  const topRev = Math.max(1, ...s.reps.map((r) => r.revenueCents));
  const topWeek = Math.max(1, ...s.weeks.map((w) => w.revenueCents));
  const thisWeek = s.weeks[s.weeks.length - 1];

  return (
    <>
      <div className="page-head">
        <h1>Sales</h1>
        <div className="page-actions"><a className="btn-primary page-btn" href="/forms/sale">+ Sales form</a></div>
      </div>
      <div className="table-bar home-numbers first">
        <HomeFrame frame={frame} from={searchParams.from ?? ""} to={searchParams.to ?? ""} path="/sales" />
      </div>
      {s.problems.length > 0 && <ul className="report-flags">{s.problems.map((p, i) => <li key={i}>{p.location}: {p.message}</li>)}</ul>}

      <div className="home-stats">
        <Stat label="Sold" value={fmt(s.soldCents)} note={`${s.sold} deal${s.sold === 1 ? "" : "s"}`} href="/ledger" />
        <Stat label="Close rate" value={pct(s.closeRate)} note={`${s.appts} appointments ran · ${s.noShows} no-show${s.noShows === 1 ? "" : "s"}`} />
        <Stat label="Avg ticket" value={s.avgCents == null ? "—" : fmt(s.avgCents)} note={`${pct(s.financedPct)} of sold dollars financed`} />
        <Stat label="Booked next 7 days" value={String(s.upcomingAppts)} note="Sales appointments on the calendars" href="/calendar" />
        <Stat label="Cancelled" value={String(s.cancelled)} note={s.cancelled ? `${fmt(s.cancelledCents)} of sales lost` : "None this period"} tone={s.cancelled ? "due" : undefined} />
      </div>
      {s.apptsFrom > s.from && <p className="muted small">Appointments and close rates cover {shortDate(s.apptsFrom)} on; the calendars aren&apos;t read further back than a year.</p>}

      <section className="board dash-block">
        <h2 className="section">Reps</h2>
        {s.reps.length === 0 ? <p className="empty">No appointments or sales in this period.</p> : (
          <div className="tablewrap">
            <table>
              <thead>
                <tr><th>Rep</th><th className="num">Appointments ran</th><th className="num">No-shows</th><th className="num">Sold</th><th className="num">Close rate</th><th className="num">Revenue</th><th className="num">Avg ticket</th><th className="num">Financed</th><th className="num">Cancelled</th><th className="num">Commission</th></tr>
              </thead>
              <tbody>
                {s.reps.map((r) => (
                  <tr key={r.name} className={r.name === "Unassigned" ? "muted" : ""}>
                    <td><span className="board-name">{r.name}</span><span className="board-bar" style={{ width: `${Math.max(2, (r.revenueCents / topRev) * 100)}%` }} /></td>
                    <td className="num">{r.appts}</td>
                    <td className="num">{r.noShows || <span className="muted">0</span>}</td>
                    <td className="num">{r.sold}</td>
                    <td className="num strong">{pct(r.closeRate)}</td>
                    <td className="num strong">{fmt(r.revenueCents)}</td>
                    <td className="num">{r.avgCents == null ? "—" : fmt(r.avgCents)}</td>
                    <td className="num">{pct(r.financedPct)}</td>
                    <td className="num">{r.cancelled || <span className="muted">0</span>}</td>
                    <td className="num">{fmt(r.commissionCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small">Appointments ran = sales appointments assigned to the rep that weren&apos;t cancelled or no-shows. Close rate = deals sold ÷ appointments ran.</p>
      </section>

      <section className="dash-block">
        <h2 className="section">Last 12 weeks</h2>
        <div className="week-bars" role="img" aria-label="Sold revenue by week, last 12 weeks">
          {s.weeks.map((w) => (
            <div key={w.week} className={`wb ${w === thisWeek ? "now" : ""}`} title={`Week of ${shortDate(w.week)}: ${fmt(w.revenueCents)} on ${w.deals} deal${w.deals === 1 ? "" : "s"}`}>
              <span className="wb-val">{w.revenueCents ? `$${Math.round(w.revenueCents / 100_000)}k` : ""}</span>
              <span className="wb-bar" style={{ height: `${Math.max(w.revenueCents ? 3 : 0, (w.revenueCents / topWeek) * 100)}%` }} />
              <span className="wb-lbl">{shortDate(w.week)}</span>
              <span className="wb-n">{w.deals}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="home-boards">
        <section className="board">
          <h2 className="section">By location</h2>
          <table>
            <thead><tr><th>Location</th><th className="num">Appointments</th><th className="num">Sold</th><th className="num">Close rate</th><th className="num">Revenue</th></tr></thead>
            <tbody>
              {s.locations.map((l) => (
                <tr key={l.name}><td>{l.name}</td><td className="num">{l.appts}</td><td className="num">{l.deals}</td><td className="num">{pct(l.closeRate)}</td><td className="num strong">{fmt(l.revenueCents)}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="board">
          <h2 className="section">By lead source</h2>
          {s.sources.length === 0 ? <p className="empty">Nothing sold in this period.</p> : (
            <table>
              <thead><tr><th>Source</th><th className="num">Deals</th><th className="num">Revenue</th></tr></thead>
              <tbody>
                {s.sources.map((x) => <tr key={x.name}><td>{x.name}</td><td className="num">{x.deals}</td><td className="num strong">{fmt(x.revenueCents)}</td></tr>)}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </>
  );
}

function Stat({ label, value, note, href, tone }: { label: string; value: string; note?: string; href?: string; tone?: "due" }) {
  const body = (
    <>
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      {note && <span className="note">{note}</span>}
    </>
  );
  return href ? <a className={`big-stat ${tone ?? ""}`} href={href}>{body}</a> : <div className={`big-stat ${tone ?? ""}`}>{body}</div>;
}
