import { shortDate, todayET } from "@/lib/dates";
import { KIND_LABEL, byPerson, payoutLines, type LineStatus, type PayoutLine } from "@/lib/ledger/payouts";
import { loadLedger } from "@/lib/ledger/repo";
import { fmt, fmtRate, sumCents } from "@/lib/money";


const VIEWS = [
  ["all", "All"],
  ["open", "Owed"],
  ["payable", "Payable now"],
  ["waiting", "Waiting on install or money"],
  ["paid", "Paid"],
] as const;
type View = (typeof VIEWS)[number][0];

const KINDS = [
  ["", "All payouts"],
  ["sales", "Sales commissions"],
  ["installer", "Installer pay"],
] as const;

const LOCATIONS = [
  ["", "All locations"],
  ["wilmington", "Wilmington"],
  ["myrtle-beach", "Myrtle Beach"],
] as const;

const STATUS_LABEL: Record<LineStatus, string> = { payable: "Payable now", waiting: "Waiting", paid: "Paid", overpaid: "Overpaid" };

const keepKind = (l: PayoutLine, kind: string) => (kind === "sales" ? l.kind !== "installer" : kind === "installer" ? l.kind === "installer" : true);

function keep(l: PayoutLine, view: View): boolean {
  if (view === "payable") return l.status === "payable" || l.status === "overpaid";
  if (view === "waiting") return l.status === "waiting";
  if (view === "open") return l.status !== "paid";
  if (view === "paid") return l.paidCents !== 0;
  return true;
}

export default async function AllCommissions({ searchParams }: { searchParams: { view?: string; kind?: string; loc?: string } }) {
  const view = (VIEWS.find(([k]) => k === searchParams.view)?.[0] ?? "all") as View;
  const kind = KINDS.find(([k]) => k === searchParams.kind)?.[0] ?? "";
  const loc = LOCATIONS.find(([k]) => k === searchParams.loc)?.[0] ?? "";

  let all: PayoutLine[];
  try {
    const rows = await loadLedger(todayET());
    all = payoutLines(loc ? rows.filter((r) => r.location === loc) : rows).filter((l) => keepKind(l, kind));
  } catch (e) {
    return (
      <>
        <h1>Commissions</h1>
        <p className="error">Could not load the ledger: {(e as Error).message}</p>
      </>
    );
  }
  // Person totals always count every line; the view only decides which lines are listed.
  const lines = all.filter((l) => keep(l, view));
  const people = byPerson(all)
    .map((p) => ({ ...p, lines: p.lines.filter((l) => keep(l, view)) }))
    .filter((p) => p.lines.length > 0);
  const href = (v: string, k: string, l: string) =>
    `/commissions?${new URLSearchParams({ tab: "all", ...(v !== "all" ? { view: v } : {}), ...(k ? { kind: k } : {}), ...(l ? { loc: l } : {}) })}`;

  return (
    <>
      <nav className="filters">
        {VIEWS.map(([k, label]) => (
          <a key={k} href={href(k, kind, loc)} className={k === view ? "on" : ""}>{label}</a>
        ))}
        <span className="sep" />
        {KINDS.map(([k, label]) => (
          <a key={k || "all"} href={href(view, k, loc)} className={k === kind ? "on" : ""}>{label}</a>
        ))}
        <span className="sep" />
        {LOCATIONS.map(([k, label]) => (
          <a key={k || "all"} href={href(view, kind, k)} className={k === loc ? "on" : ""}>{label}</a>
        ))}
      </nav>
      <p className="table-bar">
        Calculated from the Deal Ledger. Every payout becomes payable once the install is done and the money is collected in full (customer paid and lender funded).
      </p>

      <div className="tablewrap">
        <table className="payables">
          <thead>
            <tr>
              <th>Person</th>
              <th>Earns from</th>
              <th className="num">Payable now</th>
              <th className="num">Waiting</th>
              <th className="num">Paid to date</th>
              <th className="num">Earned</th>
              <th className="num">Lines</th>
            </tr>
          </thead>
          {people.map((p) => (
            <tbody key={p.person} className="person-group">
              <tr className="person-row">
                <td className="customer">{p.person}</td>
                <td className="muted">{p.kinds.map((k) => KIND_LABEL[k]).join(", ")}</td>
                <td className="num strong">{fmt(p.payableNowCents, { decimals: 2 })}</td>
                <td className="num">{fmt(p.waitingCents, { decimals: 2 })}</td>
                <td className="num">{fmt(p.paidCents, { decimals: 2 })}</td>
                <td className="num">{fmt(p.earnedCents, { decimals: 2 })}</td>
                <td className="num">{p.lines.length}</td>
              </tr>
              <tr className="detail-row">
                <td colSpan={7}>
                  <details>
                    <summary>Show {p.lines.length} line{p.lines.length === 1 ? "" : "s"}</summary>
                    <table className="lines">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Customer</th>
                          <th>Sold</th>
                          <th>Installed</th>
                          <th>For</th>
                          <th className="num">Base</th>
                          <th className="num">Rate</th>
                          <th className="num">Earned</th>
                          <th className="num">Paid</th>
                          <th className="num">Open</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.lines.map((l) => (
                          <tr key={`${l.dealId}-${l.kind}`}>
                            <td className="muted">{l.dealNumber}</td>
                            <td>{l.customer}</td>
                            <td>{shortDate(l.saleDate)}</td>
                            <td>{l.installedOn ? shortDate(l.installedOn) : "—"}</td>
                            <td>{KIND_LABEL[l.kind]}</td>
                            <td className="num">{l.baseCents == null ? "—" : fmt(l.baseCents, { decimals: 2 })}</td>
                            <td className="num">{l.rate == null ? "—" : fmtRate(l.rate)}</td>
                            <td className="num">{fmt(l.earnedCents, { decimals: 2 })}</td>
                            <td className="num">{fmt(l.paidCents, { decimals: 2 })}</td>
                            <td className={`num ${l.openCents < 0 ? "neg" : ""}`}>{fmt(l.openCents, { decimals: 2 })}</td>
                            <td>
                              <span className={`status ${l.status}`}>{STATUS_LABEL[l.status]}</span>
                              {l.waitingOn && <span className="muted"> · {l.waitingOn}</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                </td>
              </tr>
            </tbody>
          ))}
          {people.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={2}>{people.length} people</td>
                <td className="num">{fmt(sumCents(people.map((p) => p.payableNowCents)), { decimals: 2 })}</td>
                <td className="num">{fmt(sumCents(people.map((p) => p.waitingCents)), { decimals: 2 })}</td>
                <td className="num">{fmt(sumCents(people.map((p) => p.paidCents)), { decimals: 2 })}</td>
                <td className="num">{fmt(sumCents(people.map((p) => p.earnedCents)), { decimals: 2 })}</td>
                <td className="num">{lines.length}</td>
              </tr>
            </tfoot>
          )}
        </table>
        {people.length === 0 && <p className="empty">Nothing in this view.</p>}
      </div>
    </>
  );
}
