import { shortDate, todayET } from "@/lib/dates";
import { opsDashboard } from "@/lib/dashboards";
import { fmt } from "@/lib/money";
import { frameRange, isFrame, type Frame } from "@/lib/timeframe";
import HomeFrame from "../HomeFrame";

export const dynamic = "force-dynamic";
export const metadata = { title: "Operations" };

const LOC: Record<string, string> = { wilmington: "Wilmington", "myrtle-beach": "Myrtle Beach" };
const dayLabel = (d: string, today: string) =>
  d === today ? "Today" : new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });

export default async function OperationsPage({ searchParams }: { searchParams: { frame?: string; from?: string; to?: string } }) {
  const frame: Frame = isFrame(searchParams.frame) ? searchParams.frame : "thisMonth";
  const today = todayET();
  const [rf, rt] = frameRange(frame, today, searchParams.from, searchParams.to);
  const o = await opsDashboard(today, rf ?? "2000-01-01", rt ?? today);

  return (
    <>
      <div className="page-head">
        <h1>Operations</h1>
        <div className="page-actions">
          <a className="btn-primary page-btn" href="/forms/install">Installer form</a>
          <a className="btn-outline page-btn" href="/forms/purchase-order">Purchase order</a>
        </div>
      </div>
      <div className="table-bar home-numbers first">
        <HomeFrame frame={frame} from={searchParams.from ?? ""} to={searchParams.to ?? ""} path="/operations" />
      </div>
      {o.problems.length > 0 && <ul className="report-flags">{o.problems.map((p, i) => <li key={i}>{p.location}: {p.message}</li>)}</ul>}

      <div className="home-stats">
        <Stat label="Installs" value={String(o.installs)} note={`${fmt(o.installedCents)} installed`} />
        <Stat label="Sale to install" value={o.avgDaysToInstall == null ? "—" : `${o.avgDaysToInstall.toFixed(1)} days`} note="Average for installs this period" />
        <Stat label="Needs attention" value={String(o.needsAttention.length)} note="Install date passed, no install recorded" tone={o.needsAttention.length ? "due" : undefined} href="#attention" />
        <Stat label="Awaiting install" value={String(o.awaitingInstall)} note={`${fmt(o.awaitingInstallCents)} sold${o.noDate ? ` · ${o.noDate} with no date` : ""}`} href="/ledger" />
        <Stat label="Owed after install" value={fmt(o.owedAfterInstallCents)} note={`${o.owedAfterInstall} installed job${o.owedAfterInstall === 1 ? "" : "s"} not fully paid`} href="/ledger?view=receivables" />
      </div>

      <div className="home-boards">
        <section className="board">
          <h2 className="section">Install capacity</h2>
          {o.capacity.length === 0 ? <p className="empty">Set up installers on <a href="/capacity">Capacity</a>.</p> : (
            <table>
              <thead><tr><th>Location</th><th className="num">This week</th><th className="num">Next week</th><th className="num">Backlog</th></tr></thead>
              <tbody>
                {o.capacity.map((c) => (
                  <tr key={c.name}>
                    <td><a href={`/capacity?loc=${c.name === "Wilmington" ? "wilmington" : "myrtle-beach"}`}>{c.name}</a></td>
                    {c.weeks.map((w) => (
                      <td key={w.label} className="num">
                        {w.booked} / {w.capacity || "—"}
                        {w.capacity > 0 && <span className={`util-chip ${w.booked > w.capacity ? "over" : w.booked / w.capacity >= 0.85 ? "full" : ""}`}>{Math.round((w.booked / w.capacity) * 100)}%</span>}
                      </td>
                    ))}
                    <td className="num">{c.backlogJobs} jobs{c.backlogWeeks != null ? ` · ${c.backlogWeeks.toFixed(1)} wk` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted small">Booked installs / install slots. Backlog = sold jobs not installed.</p>
        </section>
        <section className="board">
          <h2 className="section">Installers</h2>
          {o.installers.length === 0 ? <p className="empty">No installs in this period.</p> : (
            <table>
              <thead><tr><th>Installer</th><th className="num">Installs</th><th className="num">Revenue</th><th className="num">Days from sale</th><th className="num">Install pay</th></tr></thead>
              <tbody>
                {o.installers.map((i) => (
                  <tr key={i.name} className={i.name === "Unassigned" ? "muted" : ""}>
                    <td>{i.name}</td><td className="num strong">{i.installs}</td><td className="num">{fmt(i.revenueCents)}</td>
                    <td className="num">{i.avgDays == null ? "—" : i.avgDays.toFixed(1)}</td><td className="num">{fmt(i.payCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section className="dash-block" id="attention">
        <h2 className="section">Needs attention <span className="muted">· install date passed, nothing recorded</span></h2>
        {o.needsAttention.length === 0 ? <p className="empty">Nothing overdue.</p> : (
          <div className="tablewrap">
            <table>
              <thead><tr><th>#</th><th>Customer</th><th>Location</th><th>Closer</th><th>Scheduled</th><th className="num">Days late</th><th className="num">Price</th><th /></tr></thead>
              <tbody>
                {o.needsAttention.map((d) => (
                  <tr key={d.id}>
                    <td className="muted">{d.number}</td>
                    <td><strong>{d.customer}</strong></td>
                    <td>{LOC[d.location] ?? d.location}</td>
                    <td>{d.closer ?? <span className="muted">—</span>}</td>
                    <td>{d.scheduled ? shortDate(d.scheduled) : "—"}</td>
                    <td className={`num ${(d.daysLate ?? 0) > 14 ? "neg" : ""}`}>{d.daysLate}</td>
                    <td className="num">{fmt(d.priceCents)}</td>
                    <td><a className="linkbtn" href={`/forms/install?deal=${d.id}`}>Record install</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="dash-block">
        <h2 className="section">Installs, next 2 weeks</h2>
        {o.upcoming.length === 0 ? <p className="empty">No installs on the calendars.</p> : (
          <div className="ops-days">
            {o.upcoming.map((g) => (
              <div key={g.day} className={`ops-day ${g.day === today ? "today" : ""}`}>
                <div className="ops-day-head"><strong>{dayLabel(g.day, today)}</strong><span className="muted">{g.events.length}</span></div>
                <ul>
                  {g.events.map((e) => (
                    <li key={`${e.location}:${e.id}`}>
                      <span className="t">{timeOf(e.start)}</span>
                      <span className="title">{e.title.replace(/\s*[—–-]\s*install.*$/i, "")}</span>
                      <span className="muted">{e.locationName}{e.assignedTo ? ` · ${e.assignedTo}` : ""}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="board dash-block">
          <h2 className="section">Stock to order</h2>
          {o.stockAlerts.length === 0 ? <p className="empty">Every warehouse is covered for the next 3 weeks.</p> : (
            <table>
              <thead><tr><th>Product</th><th>Warehouse</th><th className="num">Available</th><th className="num">On order</th><th className="num">Weeks of cover</th><th>Status</th></tr></thead>
              <tbody>
                {o.stockAlerts.map((r) => (
                  <tr key={`${r.location}:${r.skuCode}`}>
                    <td><strong>{r.skuCode}</strong> <span className="muted">{r.name}</span></td>
                    <td>{r.location}</td>
                    <td className={`num ${r.available < 0 ? "neg" : ""}`}>{r.available}</td>
                    <td className="num">{r.onOrder}</td>
                    <td className="num">{r.weeksOfCover == null ? "—" : r.weeksOfCover.toFixed(1)}</td>
                    <td><span className={`inv-status ${r.status}`}>{r.status === "short" ? "Short" : "Order"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted small"><a href="/inventory">Inventory</a> · <a href="/forms/purchase-order">New purchase order</a></p>
      </section>
      <section className="board dash-block">
          <h2 className="section">Open purchase orders</h2>
          {o.openPOs.length === 0 ? <p className="empty">Nothing on order.</p> : (
            <table>
              <thead><tr><th>PO</th><th>Vendor</th><th>Warehouse</th><th className="num">Units</th><th>Expected</th></tr></thead>
              <tbody>
                {o.openPOs.map((p) => (
                  <tr key={p.number}>
                    <td>#{p.number}</td><td>{p.vendor}</td><td>{p.location}</td><td className="num">{p.units}</td>
                    <td className={p.late ? "neg" : ""}>{p.expectedOn ? shortDate(p.expectedOn) : "—"}{p.late ? " (late)" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </section>
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
