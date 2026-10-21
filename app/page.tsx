import { shortDate, todayET } from "@/lib/dates";
import { fmt } from "@/lib/money";
import { homeMetrics, type PersonStat } from "@/lib/reports";

export const dynamic = "force-dynamic";

const WINDOWS = [7, 30, 90] as const;

export default async function Home({ searchParams }: { searchParams: { days?: string } }) {
  const days = WINDOWS.find((d) => String(d) === searchParams.days) ?? 30;
  const today = todayET();
  const m = await homeMetrics(today, days);
  const bankBehind = m.bankThrough != null && m.bankThrough < today;

  return (
    <>
      <h1>Home</h1>
      <div className="table-bar">
        <nav className="segmented" aria-label="Period">
          {WINDOWS.map((d) => (
            <a key={d} href={d === 30 ? "/" : `/?days=${d}`} className={d === days ? "on" : ""} aria-current={d === days ? "page" : undefined}>
              Last {d} days
            </a>
          ))}
        </nav>
        <span className="muted">{shortDate(m.from)} to {shortDate(m.to)}</span>
      </div>

      <div className="home-stats">
        <Big label="Revenue" value={fmt(m.soldCents)} href="/ledger" />
        <Big label="Collected" value={fmt(m.collectedCents)} href="/ledger" flag={m.collectedUndated ? `${m.collectedUndated} imported payment${m.collectedUndated === 1 ? "" : "s"} dated by install day` : undefined} />
        <Big label="Accounts receivable" value={fmt(m.receivableCents)} href="/ledger" tone={m.receivableCents > 0 ? "due" : undefined} />
        <Big label="Expenses" value={fmt(m.expensesCents)} href="/reports" flag={bankBehind ? `Bank through ${shortDate(m.bankThrough)}` : m.bankThrough == null ? "Import bank statements" : undefined} />
      </div>

      <div className="home-boards">
        <Board title="Top reps" rows={m.reps} unit="Sold" />
        <Board title="Top installers" rows={m.installers} unit="Installed" />
      </div>
    </>
  );
}

function Big({ label, value, href, tone, flag }: { label: string; value: string; href: string; tone?: "due"; flag?: string }) {
  return (
    <a className={`big-stat ${tone ?? ""}`} href={href}>
      <span className="label">{label}</span>
      <span className="value">{value}</span>
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
