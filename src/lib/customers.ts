/**
 * Customer profiles. A customer is a deal (or an agreement not tied to a deal
 * yet) with everything that touched them: GoHighLevel appointments and how they
 * went, the sales form, agreements, payments and funding, the install, payouts.
 * Keys: the deal id, or "a-<agreement id>".
 */
import { db } from "./db";
import { contactDetails, customerFromTitle } from "./appointments";
import { customerName as agreementCustomer, fullAddress, listAgreements, loadAgreement, type Agreement } from "./agreements";
import { loadCalendar } from "./ghl";
import { firstLast, normName } from "./install-sync";
import { addDays } from "./ledger/payrun";
import { KIND_LABEL } from "./ledger/payouts";
import { derive } from "./ledger/derive";
import { loadDeal, loadLedger } from "./ledger/repo";
import { STAGE_LABEL, type DerivedDeal } from "./ledger/types";
import { outcomeLabel, type Outcome } from "./appointment-types";
import type { CustomerProfile, CustomerRow, TimelineItem } from "./customer-types";

const LOC: Record<string, string> = { wilmington: "Wilmington", "myrtle-beach": "Myrtle Beach" };
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s);
const money = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

export interface Viewer {
  role: "admin" | "sales" | "installer";
  personId: string | null;
}

/** Reps see customers they closed or set, or wrote an agreement for. */
const canSeeDeal = (v: Viewer, d: DerivedDeal) => v.role === "admin" || (v.personId != null && (d.closer?.id === v.personId || d.setter?.id === v.personId || d.installer?.id === v.personId));

export async function listCustomers(v: Viewer, today: string): Promise<CustomerRow[]> {
  const [deals, agreements] = await Promise.all([loadLedger(today), listAgreements(v.role === "admin" ? null : v.personId, 1000)]);
  const latestAgreement = new Map<string, Agreement>();
  for (const a of agreements) if (a.dealId && !latestAgreement.has(a.dealId)) latestAgreement.set(a.dealId, a);
  const mineByAgreement = new Set(agreements.map((a) => a.dealId).filter(Boolean));
  const rows: CustomerRow[] = deals
    .filter((d) => canSeeDeal(v, d) || mineByAgreement.has(d.id))
    .map((d) => ({
      key: d.id,
      name: d.customerName,
      phone: null,
      location: LOC[d.location] ?? d.location,
      dealNumber: d.number,
      stageLabel: STAGE_LABEL[d.stage],
      priceCents: d.priceCents,
      saleDate: d.saleDate,
      closer: d.closer?.name ?? null,
      agreement: latestAgreement.get(d.id)?.status ?? null,
    }));
  for (const a of agreements.filter((x) => !x.dealId)) {
    rows.push({
      key: `a-${a.id}`,
      name: agreementCustomer(a),
      phone: a.phone,
      location: a.location ? LOC[a.location] ?? a.location : null,
      dealNumber: null,
      stageLabel: null,
      priceCents: a.priceCents,
      saleDate: a.createdAt.slice(0, 10),
      closer: a.repName,
      agreement: a.status,
    });
  }
  return rows.sort((x, y) => (y.saleDate ?? "").localeCompare(x.saleDate ?? "") || (y.dealNumber ?? 0) - (x.dealNumber ?? 0));
}

/** null = not found or not theirs to see. */
export async function loadCustomer(key: string, v: Viewer, today: string): Promise<CustomerProfile | null> {
  if (key.startsWith("a-")) {
    const a = await loadAgreement(key.slice(2));
    if (!a || (v.role !== "admin" && a.repId !== v.personId)) return null;
    if (a.dealId) return loadCustomer(a.dealId, v, today);
    return {
      key,
      name: agreementCustomer(a),
      phone: a.phone,
      email: a.email,
      address: fullAddress(a) || null,
      location: a.location ? LOC[a.location] ?? a.location : null,
      contactUrl: null,
      deal: null,
      equipment: (a.equipment.length ? a.equipment : a.systems).map((name) => ({ name, qty: 1, installed: false })),
      agreements: [agreementSummary(a)],
      timeline: agreementEvents(a).sort(byTimeDesc),
      full: v.role === "admin",
    };
  }
  if (!isUuid(key)) return null;
  const raw = await loadDeal(key);
  if (!raw) return null;
  const d = derive(raw, today);
  const agreements = (await db().query("select id from agreements where deal_id = $1 order by created_at desc", [d.id]).catch(() => ({ rows: [] }))).rows;
  const ags = (await Promise.all(agreements.map((r) => loadAgreement(r.id as string)))).filter((a): a is Agreement => !!a);
  if (!canSeeDeal(v, d) && !(v.role === "sales" && ags.some((a) => a.repId === v.personId))) return null;
  const full = v.role === "admin";

  const extra = (
    await db().query(
      `select d.customer_phone, d.customer_email, d.customer_address, d.created_at, d.cancelled_at, d.cancel_reason, l.name as lender,
              (select p.name from people p where p.id = d.setter_id) as setter
       from deals d left join lenders l on l.id = d.lender_id where d.id = $1`,
      [d.id],
    )
  ).rows[0] ?? {};
  const [subs, disps, skus] = await Promise.all([
    db().query(`select fs.kind, fs.created_at, fs.payload, p.name as who from form_submissions fs left join people p on p.id = fs.submitted_by where fs.deal_id = $1 order by fs.created_at`, [d.id]),
    db()
      .query(
        `select ad.appointment_id, coalesce(to_jsonb(ad) ->> 'kind', 'sales') as kind, ad.outcome, ad.reason, ad.note, ad.rescheduled_to::text as rescheduled_to,
                ad.appointment_day::text as day, ad.updated_at, p.name as who
         from appointment_dispositions ad left join people p on p.id = ad.person_id
         where ad.deal_id = $1 or (ad.deal_id is null and lower(ad.customer_name) = lower($2))`,
        [d.id, d.customerName],
      )
      .catch(() => ({ rows: [] as Array<Record<string, unknown>> })),
    db().query("select code, name from skus"),
  ]);
  const skuName = new Map(skus.rows.map((r) => [r.code as string, r.name as string]));

  const t: TimelineItem[] = [];
  // ── GoHighLevel appointments around this deal, matched by customer name (or the ones the forms recorded).
  const knownAppts = new Set<string>([
    ...subs.rows.map((r) => r.payload?.appointmentId as string | undefined).filter((x): x is string => !!x),
    ...ags.map((a) => a.appointmentId).filter((x): x is string => !!x),
    ...disps.rows.map((r) => r.appointment_id as string),
  ]);
  const dispBy = new Map(disps.rows.map((r) => [r.appointment_id as string, r]));
  const until = [today, d.installScheduledOn ?? "", d.installedOn ?? ""].sort().at(-1)!;
  const cal = await loadCalendar(`${addDays(d.saleDate, -45)}T12:00:00Z`, `${addDays(until, 45)}T12:00:00Z`).catch(() => ({ events: [], problems: [] }));
  let contact: { slug: string; id: string; address: string | null } | null = null;
  const nm = normName(d.customerName);
  const fl = firstLast(d.customerName);
  for (const e of cal.events) {
    const who = normName(customerFromTitle(e.title));
    const match = knownAppts.has(e.id) || (e.location === d.location && (who === nm || normName(e.title) === nm || (fl != null && firstLast(customerFromTitle(e.title)) === fl)));
    if (!match) continue;
    const disp = dispBy.get(e.id);
    if (!contact && e.contactUrl) contact = { slug: e.location, id: e.contactUrl.split("/").pop()!, address: e.address };
    const statusNote = e.status === "noshow" ? "No-show" : e.status === "cancelled" ? "Cancelled in GoHighLevel" : e.status === "showed" ? "Showed" : null;
    t.push({
      at: e.start,
      kind: "appointment",
      title: `${e.kind === "install" ? "Install appointment" : "Sales appointment"}${e.assignedTo ? ` with ${e.assignedTo}` : ""}`,
      detail: [e.title, statusNote, disp ? outcomeLabel({ outcome: disp.outcome as Outcome, reason: (disp.reason as string) ?? null, rescheduledTo: (disp.rescheduled_to as string) ?? null, dealNumber: d.number }) : null, (disp?.note as string) || null].filter(Boolean).join(" · "),
      href: e.contactUrl,
      future: e.start.slice(0, 10) > today,
    });
    dispBy.delete(e.id);
  }
  // Outcomes whose appointment wasn't found on the calendar.
  for (const r of dispBy.values()) {
    if (r.outcome === "closed" || r.outcome === "completed") continue;
    t.push({ at: new Date(r.updated_at as string).toISOString(), kind: "disposition", title: `${r.kind === "install" ? "Install" : "Appointment"}: ${outcomeLabel({ outcome: r.outcome as Outcome, reason: (r.reason as string) ?? null, rescheduledTo: (r.rescheduled_to as string) ?? null, dealNumber: null })}`, detail: (r.note as string) ?? null, who: (r.who as string) ?? null });
  }

  // ── Forms
  const hasSaleForm = subs.rows.some((r) => r.kind === "sale");
  for (const r of subs.rows) {
    const at = new Date(r.created_at as string).toISOString();
    if (r.kind === "sale") t.push({ at, kind: "sale", title: `Sold: ${money(d.priceCents)}`, detail: "Sales form", who: (r.who as string) ?? d.closer?.name ?? null });
    if (r.kind === "install") t.push({ at, kind: "installed", title: "Install recorded", detail: "Installer form", who: (r.who as string) ?? null });
    if (r.kind === "funding") t.push({ at, kind: "funding", title: `Funding recorded: ${money(Number(r.payload?.amountCents ?? 0))}`, detail: `Lender fee ${money(Number(r.payload?.lenderFeeCents ?? 0))}`, who: null });
  }
  if (!hasSaleForm) t.push({ at: d.saleDate, kind: "sale", title: `Sold: ${money(d.priceCents)}`, detail: "Imported from Mission Control", who: d.closer?.name ?? null });

  // ── Agreements
  for (const a of ags) t.push(...agreementEvents(a));

  // ── Money in
  for (const p of d.payments) {
    const at = p.receivedOn ?? d.installedOn ?? d.saleDate;
    if (p.source === "lender") t.push({ at, kind: "funding", title: `${d.lender ?? "Lender"} funded ${money(p.amountCents)}`, detail: p.feeCents ? `Lender fee ${money(p.feeCents)}` : null });
    else t.push({ at, kind: "payment", title: `Customer paid ${money(p.amountCents)}`, detail: [p.method !== "unknown" ? p.method : null, p.feeCents ? `card fee ${money(p.feeCents)}` : null, p.receivedOn ? null : "date not recorded"].filter(Boolean).join(" · ") || null });
  }

  // ── Install
  if (d.installedOn && !subs.rows.some((r) => r.kind === "install")) t.push({ at: d.installedOn, kind: "installed", title: "Installed", who: d.installer?.name ?? null });
  const apptOnInstallDay = t.some((x) => x.kind === "appointment" && x.title.startsWith("Install") && x.at.slice(0, 10) === d.installScheduledOn);
  if (!d.installedOn && d.installScheduledOn && !apptOnInstallDay) t.push({ at: d.installScheduledOn, kind: "install-scheduled", title: "Install scheduled", detail: d.stage === "needs-attention" ? "Date passed, no install recorded" : null, future: d.installScheduledOn >= today });

  // ── Payouts (office only)
  if (full) for (const p of d.payouts) t.push({ at: p.paidOn ?? d.installedOn ?? d.saleDate, kind: "payout", title: `Paid ${KIND_LABEL[p.kind].toLowerCase()} ${money(p.amountCents)}`, who: d.payoutPositions.find((x) => x.kind === p.kind)?.person?.name ?? null });

  if (d.cancelledAt) t.push({ at: new Date(d.cancelledAt).toISOString(), kind: "cancelled", title: "Deal cancelled", detail: d.cancelReason ?? null });

  // Imported deals often lack contact details: take them from the GoHighLevel contact.
  let phone: string | null = (extra.customer_phone as string) ?? null;
  let email: string | null = (extra.customer_email as string) ?? null;
  let address: string | null = d.customerAddress;
  if (contact && (!phone || !email || !address)) {
    const c = await contactDetails(contact.slug as "wilmington" | "myrtle-beach", contact.id).catch(() => null);
    phone ||= c?.phone ?? null;
    email ||= c?.email ?? null;
    address ||= c?.address ?? contact.address?.replace(/^\s*(meeting location|location|address)\s*:\s*/i, "") ?? null;
  }
  const lineNames = d.lines.map((l) => ({ name: skuName.get(l.skuCode) ?? l.skuCode, qty: l.qty, installed: d.isInstalled }));
  return {
    key: d.id,
    name: d.customerName,
    phone,
    email,
    address,
    location: LOC[d.location] ?? d.location,
    contactUrl: t.find((x) => x.kind === "appointment" && x.href)?.href ?? null,
    deal: {
      id: d.id,
      number: d.number,
      stage: d.stage,
      stageLabel: STAGE_LABEL[d.stage],
      saleDate: d.saleDate,
      closer: d.closer?.name ?? null,
      setter: d.setter?.name ?? null,
      installer: d.installer?.name ?? null,
      installScheduledOn: d.installScheduledOn,
      installedOn: d.installedOn,
      priceCents: d.priceCents,
      cashCents: d.cashPortionCents,
      cardCents: d.cardPortionCents,
      financedCents: d.financedPortionCents,
      lender: d.lender,
      collectedCents: d.collectedCents,
      customerOwesCents: Math.max(0, d.cashDueCents),
      lenderOwesCents: Math.max(0, d.fundingDueCents),
      lenderFeeCents: d.loanInterestCents,
      soap: d.soap,
      maintenanceArrCents: d.maintenanceArrCents,
      netProfitCents: full ? d.netProfitCents : null,
      note: d.note,
      issues: d.issues,
    },
    equipment: lineNames,
    agreements: ags.map(agreementSummary),
    timeline: t.sort(byTimeDesc),
    full,
  };
}

function agreementSummary(a: Agreement): CustomerProfile["agreements"][number] {
  return { id: a.id, number: a.number, status: a.status, createdAt: a.createdAt, signedAt: a.signedAt, priceCents: a.priceCents, pdf: `/agreements/${a.id}/pdf` };
}

function agreementEvents(a: Agreement): TimelineItem[] {
  const out: TimelineItem[] = [{ at: a.createdAt, kind: "agreement", title: `Agreement ${a.number} prepared`, detail: money(a.priceCents), who: a.repName, href: `/agreements/${a.id}` }];
  if (a.signedAt) out.push({ at: a.signedAt, kind: "signed", title: `Agreement ${a.number} signed`, detail: `Signed electronically by ${a.signedName ?? "the customer"}`, href: `/agreements/${a.id}/pdf` });
  if (a.voidedAt) out.push({ at: a.voidedAt, kind: "cancelled", title: `Agreement ${a.number} cancelled`, detail: a.voidReason });
  return out;
}

/** Newest first; a date-only event counts as midday Eastern. */
const stamp = (at: string) => (at.length === 10 ? Date.parse(`${at}T16:00:00Z`) : Date.parse(at));
function byTimeDesc(a: TimelineItem, b: TimelineItem) {
  return stamp(b.at) - stamp(a.at);
}
