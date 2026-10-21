import { listAgreements, customerName } from "@/lib/agreements";
import { currentSession } from "@/lib/auth";
import { shortDate } from "@/lib/dates";
import { fmt } from "@/lib/money";

export const dynamic = "force-dynamic";
export const metadata = { title: "Agreements" };

const STATUS = { sent: "Waiting for signature", signed: "Signed", void: "Cancelled" } as const;

export default async function AgreementsPage() {
  const s = await currentSession();
  const rows = await listAgreements(s && s.role !== "admin" ? s.personId : null);
  return (
    <div className="agr-page">
      <div className="page-head">
        <h1>Agreements</h1>
        <div className="page-actions"><a className="btn-primary page-btn" href="/agreements/new">+ New agreement</a></div>
      </div>
      {rows.length === 0 ? (
        <p className="empty">No agreements yet. Start one from a closed appointment, after the sales form, or with New agreement.</p>
      ) : (
        <ul className="agr-list">
          {rows.map((a) => (
            <li key={a.id}>
              <a href={`/agreements/${a.id}`} className={`agr-row st-${a.status}`}>
                <span className="agr-row-main">
                  <strong>{customerName(a)}</strong>
                  <span className="muted">{a.number} · {shortDate(a.createdAt.slice(0, 10))}{s?.role === "admin" && a.repName ? ` · ${a.repName}` : ""}{a.dealNumber != null ? ` · deal #${a.dealNumber}` : ""}</span>
                </span>
                <span className="agr-row-side">
                  <span className="agr-price">{fmt(a.priceCents)}</span>
                  <span className={`agr-status st-${a.status}`}>{STATUS[a.status]}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
