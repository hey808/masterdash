import { redirect } from "next/navigation";
import { currentSession } from "@/lib/auth";
import { shortDate, todayET } from "@/lib/dates";
import { KIND_LABEL } from "@/lib/ledger/payouts";
import { loadOptions } from "@/lib/ledger/options";
import { runOf } from "@/lib/ledger/payrun";
import { loadLedger } from "@/lib/ledger/repo";
import { fmt, sumCents } from "@/lib/money";

export const dynamic = "force-dynamic";
export const metadata = { title: "My commissions" };

/**
 * One person's commissions: what's payable, what's waiting (and on what), and
 * what's been paid. Reps and installers only ever see their own; an admin can
 * pick anyone to see the page as they would.
 */
export default async function MePage({ searchParams }: { searchParams: { person?: string } }) {
  const session = await currentSession();
  if (!session) redirect("/login");
  const isAdmin = session.role === "admin";
  const options = isAdmin ? await loadOptions() : null;
  const personId = isAdmin ? searchParams.person ?? null : session.personId;
  const person = isAdmin ? options!.people.find((p) => p.id === personId) ?? null : { id: session.personId!, name: session.name };

  if (!person) {
    return (
      <>
        <h1>My commissions</h1>
        {isAdmin ? (
          <form className="table-bar" method="get">
            <span className="muted">See this page as:</span>
            <select name="person" defaultValue="" className="pick-person">
              <option value="" disabled>Choose a person…</option>
              {options!.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button type="submit" className="btn-primary">Show</button>
          </form>
        ) : (
          <p className="empty">Your login isn&apos;t linked to a roster person yet. Ask an admin to link it.</p>
        )}
      </>
    );
  }

  const today = todayET();
  const deals = (await loadLedger(today)).filter((d) => d.stage !== "cancelled");
  const lines = deals.flatMap((d) =>
    d.payoutPositions
      .filter((p) => p.person?.id === person.id && (p.earnedCents !== 0 || p.paidCents !== 0))
      .map((p) => ({ d, p, status: p.openCents < -50 ? "overpaid" : p.openCents <= 50 ? "paid" : p.payable ? "payable" : "waiting" })),
  );
  const payouts = deals
    .flatMap((d) => d.payouts.filter((x) => x.personId === person.id).map((x) => ({ d, x })))
    .sort((a, b) => (b.x.paidOn ?? "").localeCompare(a.x.paidOn ?? ""));

  const payable = sumCents(lines.filter((l) => l.status === "payable").map((l) => l.p.openCents));
  const waiting = sumCents(lines.filter((l) => l.status === "waiting").map((l) => l.p.openCents));
  const paid = sumCents(lines.map((l) => l.p.paidCents));
  const earned = sumCents(lines.map((l) => l.p.earnedCents));
  const order = { payable: 0, waiting: 1, overpaid: 2, paid: 3 } as const;
  lines.sort((a, b) => order[a.status as keyof typeof order] - order[b.status as keyof typeof order] || b.d.number - a.d.number);
  const formHref = session.role === "installer" ? "/forms/install" : session.role === "sales" ? "/forms/sale" : null;

  return (
    <>
      <div className="page-head">
        <h1>{isAdmin ? `${person.name}'s commissions` : `Hi ${person.name.split(" ")[0]}`}</h1>
        <div className="page-actions">
          {formHref && <a className="btn-primary page-btn" href={formHref}>{session.role === "installer" ? "+ Log an install" : "+ Log a sale"}</a>}
          {isAdmin && <a className="btn-outline page-btn" href="/me">Pick someone else</a>}
        </div>
      </div>

      <div className="run-totals">
        <div className="stat new"><div className="label">Ready to be paid</div><div className="value">{fmt(payable, { decimals: 2 })}</div></div>
        <div className="stat"><div className="label">Waiting on install or money</div><div className="value">{fmt(waiting, { decimals: 2 })}</div></div>
        <div className="stat paid"><div className="label">Paid to date</div><div className="value">{fmt(paid, { decimals: 2 })}</div></div>
        <div className="stat"><div className="label">Earned to date</div><div className="value">{fmt(earned, { decimals: 2 })}</div></div>
      </div>

      <h2 className="section">Your deals</h2>
      {lines.length === 0 ? (
        <p className="empty">No commissions yet.</p>
      ) : (
        <div className="tablewrap">
          <table>
            <thead>
              <tr><th>#</th><th>Customer</th><th>For</th><th>Sold</th><th>Installed</th><th className="num">Earned</th><th className="num">Paid</th><th className="num">Owed</th><th>Status</th></tr>
            </thead>
            <tbody>
              {lines.map(({ d, p, status }) => (
                <tr key={`${d.id}:${p.kind}`}>
                  <td className="muted">{d.number}</td>
                  <td><strong>{d.customerName}</strong></td>
                  <td className="muted">{KIND_LABEL[p.kind]}</td>
                  <td>{shortDate(d.saleDate)}</td>
                  <td>{d.installedOn ? shortDate(d.installedOn) : <span className="muted">not yet</span>}</td>
                  <td className="num">{fmt(p.earnedCents, { decimals: 2 })}</td>
                  <td className="num">{fmt(p.paidCents, { decimals: 2 })}</td>
                  <td className="num strong">{fmt(Math.max(0, p.openCents), { decimals: 2 })}</td>
                  <td>
                    <span className={`status ${status}`}>
                      {status === "payable" ? "Ready to pay" : status === "waiting" ? "Waiting" : status === "paid" ? "Paid" : "Overpaid"}
                    </span>
                    {status === "waiting" && p.waitingOn && <span className="act-detail">{p.waitingOn}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="section">Payments to you</h2>
      {payouts.length === 0 ? (
        <p className="empty">No payments recorded yet.</p>
      ) : (
        <div className="tablewrap">
          <table>
            <thead>
              <tr><th>Paid</th><th>Pay run</th><th>Deal</th><th>For</th><th className="num">Amount</th></tr>
            </thead>
            <tbody>
              {payouts.map(({ d, x }, i) => {
                const run = runOf(x);
                return (
                  <tr key={x.id ?? i}>
                    <td>{x.paidOn ? shortDate(x.paidOn) : <span className="muted">imported</span>}</td>
                    <td className="muted">{run ? `Fri ${shortDate(run)}` : "—"}</td>
                    <td>#{d.number} {d.customerName}</td>
                    <td className="muted">{KIND_LABEL[x.kind]}</td>
                    <td className="num strong">{fmt(x.amountCents, { decimals: 2 })}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
