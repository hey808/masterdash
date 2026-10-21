import { FORM_KINDS, INVENTORY_KINDS, loadActivity, type ActivityItem } from "@/lib/activity";
import { loadOptions } from "@/lib/ledger/options";
import { fmt } from "@/lib/money";

export const dynamic = "force-dynamic";

const SHOW = { all: { label: "All", kinds: null }, forms: { label: "Form submissions", kinds: FORM_KINDS }, inventory: { label: "Inventory", kinds: INVENTORY_KINDS } } as const;
type Show = keyof typeof SHOW;

const LABEL: Record<ActivityItem["kind"], string> = {
  sale: "Sale",
  install: "Install",
  payout: "Payout",
  po_ordered: "PO ordered",
  po_received: "PO received",
  po_cancelled: "PO cancelled",
  adjustment: "Stock adjusted",
};

const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const dayLabel = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long", month: "long", day: "numeric" });
const time = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
const po = (n: number | null) => (n == null ? "" : `PO-${String(n).padStart(4, "0")}`);

function href(show: Show, loc: string | null) {
  const q = new URLSearchParams();
  if (show !== "all") q.set("show", show);
  if (loc) q.set("loc", loc);
  const s = q.toString();
  return s ? `/activity?${s}` : "/activity";
}

export default async function ActivityPage({ searchParams }: { searchParams: { show?: string; loc?: string } }) {
  const show: Show = searchParams.show && searchParams.show in SHOW ? (searchParams.show as Show) : "all";
  const options = await loadOptions();
  const open = options.locations.filter((l) => l.active);
  const loc = open.find((l) => l.slug === searchParams.loc)?.slug ?? null;
  const items = await loadActivity({ kinds: SHOW[show].kinds ? [...SHOW[show].kinds!] : null, location: loc });

  const days: Array<{ key: string; label: string; items: ActivityItem[] }> = [];
  for (const it of items) {
    const d = new Date(it.at);
    const key = dayKey.format(d);
    const last = days[days.length - 1];
    if (last && last.key === key) last.items.push(it);
    else days.push({ key, label: dayLabel.format(d), items: [it] });
  }

  return (
    <>
      <h1>Activity</h1>
      <div className="table-bar">
        <nav className="filters views" aria-label="What to show">
          {(Object.keys(SHOW) as Show[]).map((s) => (
            <a key={s} href={href(s, loc)} className={s === show ? "on" : ""} aria-current={s === show ? "page" : undefined}>{SHOW[s].label}</a>
          ))}
        </nav>
        <nav className="filters" aria-label="Location">
          <a href={href(show, null)} className={loc == null ? "on" : ""}>All locations</a>
          {open.map((l) => (
            <a key={l.slug} href={href(show, l.slug)} className={l.slug === loc ? "on" : ""}>{l.name}</a>
          ))}
        </nav>
      </div>

      {days.length === 0 && <p className="empty">Nothing here yet. Sales and install forms, purchase orders and shelf counts show up as they happen.</p>}

      {days.map((day) => (
        <section key={day.key} className="activity-day">
          <h2 className="section">{day.label}</h2>
          <ul className="activity">
            {day.items.map((it) => (
              <li key={it.id} className={`act act-${it.kind}`}>
                <span className="act-time">{time.format(new Date(it.at))}</span>
                <span className={`act-kind k-${it.kind}`}>{LABEL[it.kind]}</span>
                <span className="act-body">
                  <Line it={it} />
                  {it.detail && <span className="act-detail">{it.detail}</span>}
                </span>
                <span className="act-loc">{it.location}</span>
                <span className="act-amt">{it.amountCents != null ? fmt(it.amountCents, { decimals: it.amountCents % 100 ? 2 : 0 }) : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

function Line({ it }: { it: ActivityItem }) {
  const deal = it.dealNumber != null ? <a href={`/ledger#deal-${it.dealNumber}`}>#{it.dealNumber} {it.customer}</a> : <span className="muted">deal removed</span>;
  switch (it.kind) {
    case "sale":
      return <span><strong>{it.who ?? "Someone"}</strong> sold {deal}{it.items ? <span className="muted"> · {it.items}</span> : null}</span>;
    case "install":
      return <span><strong>{it.who ?? "Someone"}</strong> installed {deal}{it.items ? <span className="muted"> · {it.items} left the warehouse</span> : null}{it.amountCents != null ? <span className="muted"> · collected</span> : null}</span>;
    case "payout":
      return <span>Paid <strong>{it.who ?? "someone"}</strong>{it.items ? <span className="muted"> · {it.items}</span> : null}</span>;
    case "po_ordered":
      return <span><strong>{po(it.poNumber)}</strong> ordered from {it.vendor}{it.items ? <span className="muted"> · {it.items}</span> : null}</span>;
    case "po_received":
      return <span><strong>{po(it.poNumber)}</strong> from {it.vendor} received{it.items ? <span className="muted"> · {it.items} added to the shelf</span> : null}</span>;
    case "po_cancelled":
      return <span><strong>{po(it.poNumber)}</strong> from {it.vendor} cancelled</span>;
    case "adjustment":
      return <span>Shelf <strong>{it.items}</strong></span>;
  }
}
