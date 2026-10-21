/**
 * What a new agreement starts with: from a deal (after the sales form) or a
 * GoHighLevel appointment. Every field stays editable by the rep.
 */
import { SYSTEMS, type SoapPackage } from "./agreement-terms";
import { salesAppointments } from "./appointments";
import { db } from "./db";

export interface AgreementDraft {
  dealId: string | null;
  dealNumber: number | null;
  appointmentId: string | null;
  location: string | null;
  repId: string | null;
  firstName: string;
  lastName: string;
  address: string;
  unit: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email: string;
  systems: string[];
  equipment: string[];
  priceCents: number | null;
  financedCents: number;
  lender: string | null;
  depositCents: number;
  depositMethod: string | null;
  installDate: string | null;
  notes: string;
  soapPackage: SoapPackage;
  maintenancePlan: boolean;
}

export const emptyDraft = (): AgreementDraft => ({
  dealId: null, dealNumber: null, appointmentId: null, location: null, repId: null, firstName: "", lastName: "", address: "", unit: "", city: "", state: "", zip: "",
  phone: "", email: "", systems: [], equipment: [], priceCents: null, financedCents: 0, lender: null, depositCents: 0, depositMethod: null, installDate: null, notes: "", soapPackage: "none", maintenancePlan: false,
});

/** "Paul & Paris Crane" → first "Paul & Paris", last "Crane". */
export function splitName(full: string): { first: string; last: string } {
  const words = full.replace(/\([^)]*\)/g, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return { first: words[0] ?? "", last: "" };
  return { first: words.slice(0, -1).join(" "), last: words[words.length - 1]! };
}

/** Towns around Wilmington and Myrtle Beach, longest first so "North Myrtle Beach" wins over "Myrtle Beach". */
const TOWNS = [
  "North Myrtle Beach", "Myrtle Beach", "Murrells Inlet", "Surfside Beach", "Garden City", "Pawleys Island", "Little River", "Socastee", "Conway", "Longs", "Loris", "Aynor",
  "Wilmington", "Leland", "Southport", "Bolivia", "Winnabow", "Hampstead", "Carolina Beach", "Kure Beach", "Wrightsville Beach", "Castle Hayne", "Shallotte", "Calabash",
  "Sunset Beach", "Ocean Isle Beach", "Holden Beach", "Supply", "Boiling Spring Lakes", "Rocky Point", "Burgaw",
].sort((a, b) => b.length - a.length);

/** "162 Waterhall Dr. Murrells Inlet, SC 29576" / "4546 Highway 319, Aynor, SC, 29511" → parts, best effort. */
export function splitAddress(s: string): { address: string; city: string; state: string; zip: string } {
  const parts = s.split(",").map((p) => p.trim()).filter(Boolean);
  let zip = "";
  let state = "";
  const tail = parts[parts.length - 1] ?? "";
  const sz = tail.match(/^([A-Za-z]{2})\s*(\d{5}(?:-\d{4})?)?$/);
  if (sz) {
    state = sz[1]!.toUpperCase();
    zip = sz[2] ?? "";
    parts.pop();
  } else if (/^\d{5}(-\d{4})?$/.test(tail) && /^[A-Za-z]{2}$/.test(parts[parts.length - 2] ?? "")) {
    zip = tail;
    state = parts[parts.length - 2]!.toUpperCase();
    parts.splice(-2);
  }
  let city = parts.length >= 2 ? parts.pop()! : "";
  let street = parts.join(", ");
  // "525 Ambrosia Loop Myrtle Beach" (no comma before the city): peel off a town we serve.
  if (!city) {
    const hit = TOWNS.find((t) => new RegExp(`\\s${t.replace(/ /g, "\\s+")}$`, "i").test(street));
    if (hit) {
      city = hit;
      street = street.replace(new RegExp(`\\s${hit.replace(/ /g, "\\s+")}$`, "i"), "").trim();
    }
  }
  return { address: street, city, state, zip };
}

/** Rough system types from product names; the rep can adjust. */
export function systemsFromProducts(names: string[]): string[] {
  const out = new Set<string>();
  for (const n of names) {
    if (/soft|chlor/i.test(n)) out.add("Water Softener");
    if (/reverse osmosis|\bRO\b/i.test(n)) out.add("Reverse Osmosis");
    if (/whole[- ]home|whole[- ]house|filter\/softener|PWF/i.test(n)) out.add("Whole House Filter");
    if (/\bUV\b/i.test(n)) out.add("UV System");
    if (/iron|well/i.test(n)) out.add("Iron Filter");
  }
  return SYSTEMS.filter((s) => out.has(s));
}

export async function draftFromDeal(dealId: string): Promise<AgreementDraft | null> {
  const { rows } = await db().query(
    `select d.id, d.number, l.slug as location, d.closer_id, d.customer_name, d.customer_address, d.customer_phone, d.customer_email,
            d.price_cents, d.financed_portion_cents, d.soap, d.maintenance_arr_cents, le.name as lender, d.install_scheduled_on::text as install_on, d.note,
            coalesce((select sum(p.amount_cents) from payments p where p.deal_id = d.id and p.source = 'customer'), 0) as deposit,
            (select p.method from payments p where p.deal_id = d.id and p.source = 'customer' order by p.amount_cents desc limit 1) as deposit_method,
            coalesce((select array_agg(case when x.qty > 1 then x.qty || '× ' || s.name else s.name end order by x.sort) from deal_lines x join skus s on s.code = x.sku_code where x.deal_id = d.id), '{}') as equipment
     from deals d join locations l on l.id = d.location_id left join lenders le on le.id = d.lender_id
     where d.id = $1`,
    [dealId],
  );
  const r = rows[0];
  if (!r) return null;
  const n = splitName(r.customer_name);
  const a = splitAddress(r.customer_address ?? "");
  const equipment = (r.equipment as string[]) ?? [];
  return {
    ...emptyDraft(),
    dealId: r.id,
    dealNumber: Number(r.number),
    location: r.location,
    repId: r.closer_id,
    firstName: n.first,
    lastName: n.last,
    ...a,
    phone: r.customer_phone ?? "",
    email: r.customer_email ?? "",
    systems: systemsFromProducts(equipment),
    equipment,
    priceCents: Number(r.price_cents),
    financedCents: Number(r.financed_portion_cents),
    lender: r.lender,
    depositCents: Number(r.deposit),
    depositMethod: ["check", "card", "cash", "other"].includes(r.deposit_method) ? r.deposit_method : Number(r.deposit) > 0 ? "other" : null,
    installDate: r.install_on,
    notes: r.note ?? "",
    // The deal only knows yes/no for soap; the rep picks the tier.
    soapPackage: r.soap ? "standard" : "none",
    maintenancePlan: Number(r.maintenance_arr_cents) > 0,
  };
}

export async function draftFromAppointment(appointmentId: string, day: string, personId: string | null): Promise<AgreementDraft | null> {
  const a = (await salesAppointments(day, personId)).appointments.find((x) => x.id === appointmentId);
  if (!a) return null;
  const n = splitName(a.customerName);
  return {
    ...emptyDraft(),
    appointmentId: a.id,
    location: a.location,
    repId: a.repPersonId,
    firstName: n.first,
    lastName: n.last,
    ...splitAddress(a.address ?? ""),
    phone: a.phone ?? "",
    email: a.email ?? "",
  };
}
