import type { CustomerProfile, TimelineItem } from "@/lib/customer-types";

const money = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: c % 100 ? 2 : 0 });
const day = (d: string) => new Date(d.length === 10 ? `${d}T12:00:00Z` : d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: d.length === 10 ? "UTC" : "America/New_York" });
const when = (at: string) =>
  at.length === 10
    ? day(at)
    : new Date(at).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });

const ICON: Record<TimelineItem["kind"], string> = {
  appointment: "📅",
  disposition: "📝",
  sale: "🤝",
  agreement: "📄",
  signed: "✍️",
  payment: "💵",
  funding: "🏦",
  "install-scheduled": "🗓️",
  installed: "🔧",
  "install-outcome": "🔧",
  payout: "💸",
  cancelled: "✖️",
  note: "📝",
};

/** The whole customer: details, money, equipment, agreements and every event. Used on the page and in the ledger popup. */
export default function CustomerProfileView({ p, compact }: { p: CustomerProfile; compact?: boolean }) {
  const d = p.deal;
  return (
    <div className={`cust ${compact ? "compact" : ""}`}>
      <section className="cust-head">
        <div>
          <h2 className="cust-name">{p.name}</h2>
          <p className="muted">
            {[p.location, d ? `Deal #${d.number}` : "No deal yet", d?.closer ? `Closer ${d.closer}` : null].filter(Boolean).join(" · ")}
          </p>
        </div>
        {d && <span className={`stage ${d.stage}`}>{d.stageLabel}</span>}
      </section>

      <div className="cust-actions">
        {p.phone && <a className="btn-outline" href={`tel:${p.phone.replace(/[^\d+]/g, "")}`}>Call {p.phone}</a>}
        {p.email && <a className="btn-outline" href={`mailto:${p.email}`}>Email</a>}
        {p.address && <a className="btn-outline" href={`https://maps.google.com/?q=${encodeURIComponent(p.address)}`} target="_blank" rel="noreferrer">Map</a>}
        {p.contactUrl && <a className="btn-outline" href={p.contactUrl} target="_blank" rel="noreferrer">GoHighLevel</a>}
        {d && <a className="btn-primary" href={`/agreements/new?deal=${d.id}`}>New agreement</a>}
      </div>

      <div className="cust-grid">
        <section className="cust-card">
          <h3>Contact</h3>
          <dl>
            <div><dt>Address</dt><dd>{p.address ?? "—"}</dd></div>
            <div><dt>Phone</dt><dd>{p.phone ?? "—"}</dd></div>
            <div><dt>Email</dt><dd>{p.email ?? "—"}</dd></div>
            {d?.setter && <div><dt>Setter</dt><dd>{d.setter}</dd></div>}
            {d?.installer && <div><dt>Installer</dt><dd>{d.installer}</dd></div>}
          </dl>
        </section>

        {d && (
          <section className="cust-card">
            <h3>Money</h3>
            <dl>
              <div><dt>Price</dt><dd><strong>{money(d.priceCents)}</strong></dd></div>
              <div><dt>Cash / card / financed</dt><dd>{money(d.cashCents)} / {money(d.cardCents)} / {money(d.financedCents)}</dd></div>
              {d.lender && <div><dt>Lender</dt><dd>{d.lender}{d.lenderFeeCents ? ` · fee ${money(d.lenderFeeCents)}` : ""}</dd></div>}
              <div><dt>Collected</dt><dd>{money(d.collectedCents)}</dd></div>
              <div><dt>Customer owes</dt><dd className={d.customerOwesCents > 50 ? "owed-text" : ""}>{money(d.customerOwesCents)}</dd></div>
              {d.financedCents > 0 && <div><dt>Lender owes</dt><dd className={d.lenderOwesCents > 50 ? "owed-text" : ""}>{money(d.lenderOwesCents)}</dd></div>}
              <div><dt>Maintenance plan</dt><dd>{d.maintenanceArrCents ? `${money(d.maintenanceArrCents)}/yr` : "No"}</dd></div>
              <div><dt>Soap</dt><dd>{d.soap ? "Yes" : "No"}</dd></div>
              {d.netProfitCents != null && <div><dt>Net profit</dt><dd>{money(d.netProfitCents)}</dd></div>}
            </dl>
          </section>
        )}

        <section className="cust-card">
          <h3>Equipment</h3>
          {p.equipment.length === 0 ? (
            <p className="muted">No products on the deal.</p>
          ) : (
            <ul className="cust-equip">
              {p.equipment.map((e, i) => (
                <li key={i}>
                  <span>{e.qty > 1 ? `${e.qty}× ` : ""}{e.name}</span>
                  <span className={`pill ${e.installed ? "ok" : ""}`}>{e.installed ? `Installed${d?.installedOn ? ` ${day(d.installedOn)}` : ""}` : d?.installScheduledOn ? `Install ${day(d.installScheduledOn)}` : "Not installed"}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="cust-card">
          <h3>Agreements</h3>
          {p.agreements.length === 0 ? (
            <p className="muted">None yet.</p>
          ) : (
            <ul className="cust-equip">
              {p.agreements.map((a) => (
                <li key={a.id}>
                  <a href={`/agreements/${a.id}`}>{a.number}</a>
                  <span className="cust-agr">
                    <span className={`agr-status st-${a.status}`}>{a.status === "signed" ? `Signed ${a.signedAt ? day(a.signedAt) : ""}` : a.status === "void" ? "Cancelled" : "Waiting for signature"}</span>
                    <a href={a.pdf} target="_blank" rel="noreferrer">PDF</a>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {d && d.issues.length > 0 && <p className="cust-issues">{d.issues.join(" · ")}</p>}
      {d?.note && <p className="cust-note">{d.note}</p>}

      <section className="cust-card">
        <h3>Activity</h3>
        {p.timeline.length === 0 ? (
          <p className="muted">Nothing recorded yet.</p>
        ) : (
          <ol className="cust-timeline">
            {p.timeline.map((e, i) => (
              <li key={i} className={`k-${e.kind} ${e.future ? "future" : ""}`}>
                <span className="ct-icon" aria-hidden="true">{ICON[e.kind]}</span>
                <div className="ct-body">
                  <div className="ct-top">
                    <strong>{e.href ? <a href={e.href} target={e.href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">{e.title}</a> : e.title}</strong>
                    <span className="ct-when">{e.future ? "Upcoming · " : ""}{when(e.at)}</span>
                  </div>
                  {(e.detail || e.who) && <div className="ct-detail">{[e.who, e.detail].filter(Boolean).join(" · ")}</div>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
