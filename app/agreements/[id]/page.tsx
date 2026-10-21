import { notFound } from "next/navigation";
import { balanceAtInstall, customerName, fullAddress, loadAgreement } from "@/lib/agreements";
import { currentSession } from "@/lib/auth";
import { fmt } from "@/lib/money";
import ShareAgreement from "../ShareAgreement";
import VoidAgreement from "./VoidAgreement";

export const dynamic = "force-dynamic";
export const metadata = { title: "Agreement" };

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });

export default async function AgreementPage({ params }: { params: { id: string } }) {
  const s = await currentSession();
  const a = await loadAgreement(params.id);
  if (!a || !s || (s.role !== "admin" && a.repId !== s.personId)) notFound();
  return (
    <div className="agr-page">
      <p className="crumb"><a href="/customers">Customers</a> / <a href={a.dealId ? `/customers/${a.dealId}` : `/customers/a-${a.id}`}>{customerName(a)}</a> / Agreement {a.number}</p>
      <div className="page-head">
        <h1>{customerName(a)}</h1>
        <span className={`agr-status st-${a.status}`}>{a.status === "sent" ? "Waiting for signature" : a.status === "signed" ? "Signed" : "Cancelled"}</span>
      </div>
      {a.status === "signed" && a.signedAt && <p className="saved-note">Signed {when(a.signedAt)}.</p>}
      {a.status === "void" && <p className="flash">Cancelled{a.voidReason ? `: ${a.voidReason}` : ""}.</p>}

      <dl className="agr-facts">
        <div><dt>Agreement</dt><dd>{a.number}</dd></div>
        <div><dt>Address</dt><dd>{fullAddress(a) || "—"}</dd></div>
        <div><dt>Phone</dt><dd>{a.phone ?? "—"}</dd></div>
        <div><dt>Email</dt><dd>{a.email ?? "—"}</dd></div>
        <div><dt>Equipment</dt><dd>{(a.equipment.length ? a.equipment : a.systems).join(", ")}</dd></div>
        <div><dt>Total</dt><dd><strong>{fmt(a.priceCents, { decimals: 2 })}</strong></dd></div>
        {a.financedCents > 0 && <div><dt>Financed</dt><dd>{fmt(a.financedCents, { decimals: 2 })}{a.lender ? ` (${a.lender})` : ""}</dd></div>}
        {a.depositCents > 0 && <div><dt>Down payment</dt><dd>{fmt(a.depositCents, { decimals: 2 })}</dd></div>}
        <div><dt>Due at install</dt><dd>{fmt(balanceAtInstall(a), { decimals: 2 })}</dd></div>
        <div><dt>Representative</dt><dd>{a.repName ?? "—"}</dd></div>
        {a.dealNumber != null && <div><dt>Deal</dt><dd>#{a.dealNumber}</dd></div>}
      </dl>

      {a.status === "sent" && <ShareAgreement id={a.id} token={a.token} number={a.number} name={customerName(a)} phone={a.phone} email={a.email} />}
      <div className="row-actions">
        <a className="btn-outline" href={`/agreements/${a.id}/pdf`} target="_blank" rel="noreferrer">{a.status === "signed" ? "Signed PDF" : "Preview PDF"}</a>
        {a.status !== "void" && (s.role === "admin" || a.status === "sent") && <VoidAgreement id={a.id} />}
      </div>
    </div>
  );
}
