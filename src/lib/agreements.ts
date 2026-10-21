/**
 * Customer agreements. A rep prepares one (prefilled from a deal or a
 * GoHighLevel appointment); that locks the system, price and payment and
 * produces a private signing link. The customer opens the link, can correct
 * contact details, initials, draws a signature and signs. A signed agreement
 * never changes.
 */
import { createHash, randomBytes, randomInt } from "node:crypto";
import { z } from "zod";
import { db, tx } from "./db";
import { EditError } from "./ledger/edit";
import { SOAP_PACKAGES, SYSTEMS, TERMS_VERSION, initialsOf, termsText, type SoapPackage } from "./agreement-terms";

export interface Agreement {
  id: string;
  number: string;
  token: string;
  status: "sent" | "signed" | "void";
  dealId: string | null;
  dealNumber: number | null;
  appointmentId: string | null;
  location: string | null;
  repId: string | null;
  repName: string | null;
  firstName: string;
  lastName: string;
  address: string | null;
  unit: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  phone2: string | null;
  email: string | null;
  hardness: string | null;
  systems: string[];
  equipment: string[];
  soapPackage: SoapPackage;
  maintenancePlan: boolean;
  priceCents: number;
  financedCents: number;
  lender: string | null;
  depositCents: number;
  depositMethod: string | null;
  installDate: string | null;
  notes: string | null;
  installerNotes: string | null;
  repInitials: string | null;
  termsVersion: string;
  termsText: string;
  customerInitials: string | null;
  signaturePng: string | null;
  signedName: string | null;
  signedAt: string | null;
  signedIp: string | null;
  signedUserAgent: string | null;
  signedHash: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  createdAt: string;
}

const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());

const SELECT = `
  select a.*, a.install_date::text as install_date_text, l.slug as location_slug, p.name as rep_name, d.number as deal_number
  from agreements a
  left join locations l on l.id = a.location_id
  left join people p on p.id = a.rep_id
  left join deals d on d.id = a.deal_id`;

function row(r: Record<string, unknown>): Agreement {
  return {
    id: r.id as string,
    number: r.number as string,
    token: r.token as string,
    status: r.status as Agreement["status"],
    dealId: (r.deal_id as string) ?? null,
    dealNumber: r.deal_number == null ? null : Number(r.deal_number),
    appointmentId: (r.appointment_id as string) ?? null,
    location: (r.location_slug as string) ?? null,
    repId: (r.rep_id as string) ?? null,
    repName: (r.rep_name as string) ?? null,
    firstName: r.first_name as string,
    lastName: r.last_name as string,
    address: (r.address as string) ?? null,
    unit: (r.unit as string) ?? null,
    city: (r.city as string) ?? null,
    state: (r.state as string) ?? null,
    zip: (r.zip as string) ?? null,
    phone: (r.phone as string) ?? null,
    phone2: (r.phone2 as string) ?? null,
    email: (r.email as string) ?? null,
    hardness: (r.hardness as string) ?? null,
    systems: (r.systems as string[]) ?? [],
    equipment: (r.equipment as string[]) ?? [],
    soapPackage: r.soap_package as SoapPackage,
    maintenancePlan: !!r.maintenance_plan,
    priceCents: Number(r.price_cents),
    financedCents: Number(r.financed_cents),
    lender: (r.lender as string) ?? null,
    depositCents: Number(r.deposit_cents),
    depositMethod: (r.deposit_method as string) ?? null,
    installDate: (r.install_date_text as string) ?? null,
    notes: (r.notes as string) ?? null,
    installerNotes: (r.installer_notes as string) ?? null,
    repInitials: (r.rep_initials as string) ?? null,
    termsVersion: r.terms_version as string,
    termsText: r.terms_text as string,
    customerInitials: (r.customer_initials as string) ?? null,
    signaturePng: (r.signature_png as string) ?? null,
    signedName: (r.signed_name as string) ?? null,
    signedAt: iso(r.signed_at),
    signedIp: (r.signed_ip as string) ?? null,
    signedUserAgent: (r.signed_user_agent as string) ?? null,
    signedHash: (r.signed_hash as string) ?? null,
    voidedAt: iso(r.voided_at),
    voidReason: (r.void_reason as string) ?? null,
    createdAt: iso(r.created_at)!,
  };
}

export const customerName = (a: Pick<Agreement, "firstName" | "lastName">) => `${a.firstName} ${a.lastName}`.trim();
export const fullAddress = (a: Pick<Agreement, "address" | "unit" | "city" | "state" | "zip">) =>
  [[a.address, a.unit].filter(Boolean).join(" "), a.city, [a.state, a.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
/** Due at install: price − financed − deposit. */
export const balanceAtInstall = (a: Pick<Agreement, "priceCents" | "financedCents" | "depositCents">) => Math.max(0, a.priceCents - a.financedCents - a.depositCents);

export async function loadAgreement(id: string): Promise<Agreement | null> {
  if (!z.string().uuid().safeParse(id).success) return null;
  const { rows } = await db().query(`${SELECT} where a.id = $1`, [id]);
  return rows[0] ? row(rows[0]) : null;
}

export async function loadAgreementByToken(token: string): Promise<Agreement | null> {
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) return null;
  const { rows } = await db().query(`${SELECT} where a.token = $1`, [token]);
  return rows[0] ? row(rows[0]) : null;
}

/** A rep's own, or everyone's (repId null). Newest first. */
export async function listAgreements(repId: string | null, limit = 200): Promise<Agreement[]> {
  try {
    const { rows } = await db().query(`${SELECT} where ($1::uuid is null or a.rep_id = $1) order by a.created_at desc limit $2`, [repId, limit]);
    return rows.map(row);
  } catch (e) {
    if ((e as { code?: string }).code === "42P01") return [];
    throw e;
  }
}

/* ── Create ──────────────────────────────────────────────────────────── */

const text = (max: number) => z.string().trim().max(max).optional().nullable().transform((s) => (s ? s : null));
const cents = z.number().int().min(0).max(100_000_000_00);

export const NewAgreement = z
  .object({
    dealId: z.string().uuid().nullable().optional(),
    appointmentId: z.string().max(64).nullable().optional(),
    location: z.string().regex(/^[a-z0-9-]+$/).nullable().optional(),
    repId: z.string().uuid(),
    firstName: z.string().trim().min(1, "First name is required").max(80),
    lastName: z.string().trim().min(1, "Last name is required").max(80),
    address: text(200),
    unit: text(60),
    city: text(80),
    state: text(40),
    zip: text(20),
    phone: z.string().trim().min(7, "Phone is required").max(40),
    phone2: text(40),
    email: z.string().trim().email("That email doesn't look right").max(200).optional().nullable().or(z.literal("")).transform((s) => (s ? s : null)),
    hardness: text(60),
    systems: z.array(z.enum(SYSTEMS)).max(SYSTEMS.length).default([]),
    equipment: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
    soapPackage: z.enum(Object.keys(SOAP_PACKAGES) as [SoapPackage, ...SoapPackage[]]).default("none"),
    maintenancePlan: z.boolean().default(false),
    priceCents: cents.refine((n) => n > 0, "Enter the total price"),
    financedCents: cents.default(0),
    lender: text(80),
    depositCents: cents.default(0),
    depositMethod: z.enum(["check", "card", "cash", "other"]).nullable().optional(),
    installDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    notes: text(2000),
    installerNotes: text(2000),
  })
  .superRefine((v, ctx) => {
    if (v.financedCents + v.depositCents > v.priceCents) ctx.addIssue({ code: "custom", path: ["depositCents"], message: "Financed plus deposit is more than the price" });
    if (v.depositCents > 0 && !v.depositMethod) ctx.addIssue({ code: "custom", path: ["depositMethod"], message: "Pick how the deposit was paid" });
    if (v.equipment.length === 0 && v.systems.length === 0) ctx.addIssue({ code: "custom", path: ["systems"], message: "Pick at least one system" });
  });

const NUMBER_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newNumber = () => Array.from({ length: 8 }, () => NUMBER_CHARS[randomInt(NUMBER_CHARS.length)]).join("");

export async function createAgreement(input: unknown, actor: string): Promise<{ id: string; token: string; number: string }> {
  const p = NewAgreement.safeParse(input);
  if (!p.success) throw new EditError(p.error.issues[0]?.message ?? "Check the form", 400);
  const v = p.data;
  return tx(actor, async (c) => {
    const rep = (await c.query("select id, name from people where id = $1", [v.repId])).rows[0];
    if (!rep) throw new EditError("Pick the representative.", 400);
    const loc = v.location ? (await c.query("select id from locations where slug = $1", [v.location])).rows[0] : null;
    if (v.dealId && !(await c.query("select 1 from deals where id = $1", [v.dealId])).rowCount) throw new EditError("That deal no longer exists.", 400);
    const equipment = v.equipment.length ? v.equipment : v.systems;
    for (let attempt = 0; attempt < 5; attempt++) {
      const number = newNumber();
      const token = randomBytes(24).toString("base64url");
      const r = await c.query(
        `insert into agreements (number, token, deal_id, appointment_id, location_id, rep_id, first_name, last_name, address, unit, city, state, zip,
           phone, phone2, email, hardness, systems, equipment, soap_package, maintenance_plan, price_cents, financed_cents, lender,
           deposit_cents, deposit_method, install_date, notes, installer_notes, rep_initials, terms_version, terms_text, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33)
         on conflict (number) do nothing returning id`,
        [
          number, token, v.dealId ?? null, v.appointmentId ?? null, loc?.id ?? null, rep.id, v.firstName, v.lastName, v.address, v.unit, v.city, v.state, v.zip,
          v.phone, v.phone2, v.email, v.hardness, v.systems, equipment, v.soapPackage, v.maintenancePlan, v.priceCents, v.financedCents, v.financedCents > 0 ? v.lender : null,
          v.depositCents, v.depositCents > 0 ? v.depositMethod : null, v.installDate ?? null, v.notes, v.installerNotes, initialsOf(rep.name), TERMS_VERSION, termsText(), actor,
        ],
      );
      if (r.rows[0]) return { id: r.rows[0].id as string, token, number };
    }
    throw new EditError("Couldn't number the agreement. Try again.", 409);
  });
}

/* ── Sign ────────────────────────────────────────────────────────────── */

export const SignInput = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(80),
  lastName: z.string().trim().min(1, "Last name is required").max(80),
  address: text(200),
  unit: text(60),
  city: text(80),
  state: text(40),
  zip: text(20),
  phone: z.string().trim().min(7, "Phone is required").max(40),
  phone2: text(40),
  email: z.string().trim().email("That email doesn't look right").max(200).optional().nullable().or(z.literal("")).transform((s) => (s ? s : null)),
  initials: z.string().trim().min(1, "Add your initials").max(6),
  signature: z
    .string()
    .max(600_000, "That signature is too large. Clear it and sign again.")
    .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, "Draw your signature"),
  consent: z.literal(true, { errorMap: () => ({ message: "Check the box to agree to sign electronically" }) }),
});

/** What was signed, in a stable order, for the document hash. */
export function signedContent(a: Agreement): string {
  return JSON.stringify({
    number: a.number,
    customer: { firstName: a.firstName, lastName: a.lastName, address: a.address, unit: a.unit, city: a.city, state: a.state, zip: a.zip, phone: a.phone, phone2: a.phone2, email: a.email },
    rep: a.repName,
    hardness: a.hardness,
    systems: a.systems,
    equipment: a.equipment,
    soapPackage: a.soapPackage,
    maintenancePlan: a.maintenancePlan,
    priceCents: a.priceCents,
    financedCents: a.financedCents,
    lender: a.lender,
    depositCents: a.depositCents,
    depositMethod: a.depositMethod,
    installDate: a.installDate,
    notes: a.notes,
    termsVersion: a.termsVersion,
    termsText: a.termsText,
    customerInitials: a.customerInitials,
    repInitials: a.repInitials,
    signedName: a.signedName,
    signature: a.signaturePng,
  });
}

export async function signAgreement(token: string, input: unknown, meta: { ip: string | null; userAgent: string | null }): Promise<Agreement> {
  const p = SignInput.safeParse(input);
  if (!p.success) throw new EditError(p.error.issues[0]?.message ?? "Check the form", 400);
  const v = p.data;
  const cur = await loadAgreementByToken(token);
  if (!cur) throw new EditError("This link isn't valid.", 404);
  if (cur.status === "void") throw new EditError("This agreement was cancelled. Contact your representative.", 409);
  if (cur.status === "signed") throw new EditError("This agreement is already signed.", 409);
  // The customer may correct contact details only; system, price and payment stay as sent.
  const next: Agreement = {
    ...cur,
    firstName: v.firstName,
    lastName: v.lastName,
    address: v.address,
    unit: v.unit,
    city: v.city,
    state: v.state,
    zip: v.zip,
    phone: v.phone,
    phone2: v.phone2,
    email: v.email,
    customerInitials: v.initials.toUpperCase(),
    signedName: `${v.firstName} ${v.lastName}`.trim(),
    signaturePng: v.signature,
  };
  const hash = createHash("sha256").update(signedContent(next)).digest("hex");
  await tx(`sign:${cur.number}`, async (c) => {
    const r = await c.query(
      `update agreements set first_name = $2, last_name = $3, address = $4, unit = $5, city = $6, state = $7, zip = $8, phone = $9, phone2 = $10, email = $11,
         customer_initials = $12, signed_name = $13, signature_png = $14, signed_at = now(), signed_ip = $15, signed_user_agent = $16, signed_hash = $17,
         status = 'signed', updated_at = now()
       where id = $1 and status = 'sent'`,
      [cur.id, next.firstName, next.lastName, next.address, next.unit, next.city, next.state, next.zip, next.phone, next.phone2, next.email,
        next.customerInitials, next.signedName, next.signaturePng, meta.ip, meta.userAgent?.slice(0, 400) ?? null, hash],
    );
    if (!r.rowCount) throw new EditError("This agreement was just signed or cancelled. Reload the page.", 409);
  });
  return (await loadAgreementByToken(token))!;
}

export async function voidAgreement(id: string, reason: string, actor: string): Promise<void> {
  const r = z.string().trim().min(3, "Say why it's being cancelled").max(300).safeParse(reason);
  if (!r.success) throw new EditError(r.error.issues[0]!.message, 400);
  await tx(actor, async (c) => {
    const u = await c.query("update agreements set status = 'void', voided_at = now(), void_reason = $2, updated_at = now() where id = $1 and status <> 'void'", [id, r.data]);
    if (!u.rowCount) throw new EditError("That agreement is already cancelled.", 409);
  });
}
