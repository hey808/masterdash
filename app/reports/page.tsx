import { todayET } from "@/lib/dates";
import { fmt } from "@/lib/money";
import { buildStatements, type StatementLine } from "@/lib/reports";

export const dynamic = "force-dynamic";

const TABS = { income: "Income statement", balance: "Balance sheet", cash: "Cash flow" } as const;
type Tab = keyof typeof TABS;

const monthName = (m: string, partialThrough?: string | null) => {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  const name = new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  return partialThrough && partialThrough.startsWith(m) ? `${name} to date` : name;
};

export default async function ReportsPage({ searchParams }: { searchParams: { tab?: string } }) {
  const tab: Tab = searchParams.tab && searchParams.tab in TABS ? (searchParams.tab as Tab) : "income";
  const today = todayET();
  const s = await buildStatements(today);
  const flags = tab === "balance" ? s.balance.flags : s.flags;

  return (
    <>
      <h1>Reports</h1>
      <nav className="tabs">
        {(Object.keys(TABS) as Tab[]).map((t) => (
          <a key={t} href={t === "income" ? "/reports" : `/reports?tab=${t}`} className={t === tab ? "on" : ""} aria-current={t === tab ? "page" : undefined}>{TABS[t]}</a>
        ))}
      </nav>

      {!s.bankFrom && tab !== "balance" && <p className="hint block">Import bank statements on the Bank tab to fill in expenses and cash.</p>}
      {flags.length > 0 && (
        <ul className="report-flags">
          {flags.map((f) => <li key={f}>{f}</li>)}
        </ul>
      )}

      {tab === "balance" ? (
        <Statement title={`As of ${new Date(`${s.balance.asOf}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}`} columns={[]} lines={s.balance.lines} single />
      ) : (
        <Statement columns={s.months.map((m, i) => monthName(m, i === s.months.length - 1 ? today : null))} lines={tab === "income" ? s.income : s.cashFlow} />
      )}
    </>
  );
}

function Statement({ columns, lines, single, title }: { columns: string[]; lines: StatementLine[]; single?: boolean; title?: string }) {
  const cell = (v: number) => (v === 0 ? "—" : v < 0 ? `(${fmt(-v)})` : fmt(v));
  return (
    <div className="tablewrap">
      <table className="statement">
        <thead>
          <tr>
            <th>{title ?? ""}</th>
            {single ? <th className="num" /> : columns.map((c) => <th key={c} className="num">{c}</th>)}
            {!single && <th className="num">Total</th>}
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.key} className={`st-${l.style ?? "detail"}`}>
              <td title={l.source}>
                {l.label}
                {l.flag && <span className="st-flag" title={l.flag}> ⚠ {l.flag}</span>}
              </td>
              {l.style === "heading" ? (
                <td colSpan={single ? 1 : columns.length + 1} />
              ) : single ? (
                <td className="num">{cell(l.total)}</td>
              ) : (
                <>
                  {l.values.map((v, i) => <td key={i} className={`num ${v < 0 ? "neg-paren" : ""}`}>{cell(v)}</td>)}
                  <td className={`num total ${l.total < 0 ? "neg-paren" : ""}`}>{l.key === "cf-open" ? cell(l.values[0] ?? 0) : cell(l.total)}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
