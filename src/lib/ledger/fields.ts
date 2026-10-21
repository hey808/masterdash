/**
 * The typed (human-entered) fields of a deal and how each one is edited.
 * Shared by the ledger grid (client) and the edit API (server), so the two
 * can never disagree about what is editable or how a value is shaped.
 *
 * Anything not listed here is calculated and read-only.
 */
import { z } from "zod";

export type FieldKind = "text" | "date" | "money" | "rate" | "person" | "location" | "lender" | "products" | "bool" | "cancel";

export interface FieldDef {
  kind: FieldKind;
  label: string;
  /** Column on `deals` for the simple kinds. */
  column?: string;
  required?: boolean;
  /** For person fields: which roster roles to offer first. */
  role?: "closer" | "manager" | "setter" | "canvasser" | "installer";
}

export const FIELDS = {
  customerName: { kind: "text", label: "Customer", column: "customer_name", required: true },
  customerAddress: { kind: "text", label: "Address", column: "customer_address" },
  location: { kind: "location", label: "Location" },
  leadSource: { kind: "text", label: "Lead source", column: "lead_source" },
  closer: { kind: "person", label: "Closer", column: "closer_id", role: "closer" },
  setter: { kind: "person", label: "Setter", column: "setter_id", role: "setter" },
  manager: { kind: "person", label: "Manager", column: "manager_id", role: "manager" },
  installer: { kind: "person", label: "Installer", column: "installer_id", role: "installer" },
  saleDate: { kind: "date", label: "Sold", column: "sale_date", required: true },
  products: { kind: "products", label: "Products" },
  priceCents: { kind: "money", label: "Price", column: "price_cents", required: true },
  cashPortionCents: { kind: "money", label: "Cash portion", column: "cash_portion_cents", required: true },
  financedPortionCents: { kind: "money", label: "Financed", column: "financed_portion_cents", required: true },
  lender: { kind: "lender", label: "Lender" },
  lenderRate: { kind: "rate", label: "Lender fee %", column: "lender_rate", required: true },
  commissionRate: { kind: "rate", label: "Commission %", column: "commission_rate", required: true },
  managerRate: { kind: "rate", label: "Override %", column: "manager_rate", required: true },
  adminFeeCents: { kind: "money", label: "Admin fee", column: "admin_fee_cents", required: true },
  extrasCents: { kind: "money", label: "Extras", column: "extras_cents", required: true },
  installerPayCents: { kind: "money", label: "Installer pay", column: "installer_pay_cents" },
  installScheduledOn: { kind: "date", label: "Install scheduled", column: "install_scheduled_on" },
  installedOn: { kind: "date", label: "Installed", column: "installed_on" },
  installed: { kind: "bool", label: "Installed" },
  closed: { kind: "bool", label: "Done" },
  /** A reason cancels the deal; null restores it. */
  cancelled: { kind: "cancel", label: "Cancelled" },
  note: { kind: "text", label: "Note", column: "note" },
} as const satisfies Record<string, FieldDef>;

export type FieldKey = keyof typeof FIELDS;
export const isFieldKey = (k: string): k is FieldKey => Object.prototype.hasOwnProperty.call(FIELDS, k);

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-10-20");
const cents = z.number().int("Whole cents only").min(0, "Can't be negative").max(100_000_000_00, "Too large");
const rate = z.number().min(0, "Can't be negative").max(1, "Must be 100% or less");
const uuid = z.string().uuid();

/** The value schema for each field kind. `null` means "clear the cell". */
export function valueSchema(key: FieldKey): z.ZodTypeAny {
  const f: FieldDef = FIELDS[key];
  const opt = <T extends z.ZodTypeAny>(s: T) => (f.required ? s : s.nullable());
  switch (f.kind) {
    case "text":
      return f.required ? z.string().trim().min(1, `${f.label} can't be blank`).max(500) : z.string().trim().max(2000).nullable();
    case "date":
      return opt(date);
    case "money":
      return opt(cents);
    case "rate":
      return rate;
    case "person":
      return uuid.nullable();
    case "location":
      return z.string().regex(/^[a-z0-9-]+$/);
    case "lender":
      return z.string().min(1).nullable();
    case "products":
      return z.array(z.object({ skuCode: z.string().min(1), qty: z.number().int().min(1).max(20) })).max(20);
    case "bool":
      return z.boolean();
    case "cancel":
      return z.string().trim().min(2, "Say why it was cancelled").max(500).nullable();
  }
}

export const EditRequest = z.object({
  field: z.string().refine(isFieldKey, "Not an editable field"),
  value: z.unknown(),
  version: z.number().int().min(1),
});

/** "$7,495", "7495.5" → cents. Empty → null. Invalid → NaN. */
export function parseMoneyInput(s: string): number | null {
  const t = s.trim().replace(/[$,\s]/g, "");
  if (!t) return null;
  if (!/^\d*\.?\d{0,2}$/.test(t)) return NaN;
  const [w = "0", f = ""] = t.split(".");
  return Number(w || "0") * 100 + Number((f + "00").slice(0, 2));
}

/** "15", "15%", "2.5" → 0.15, 0.15, 0.025 (always percent). Empty/invalid → NaN. */
export function parseRateInput(s: string): number {
  const t = s.trim().replace("%", "");
  if (!t || !/^\d*\.?\d*$/.test(t)) return NaN;
  return Math.round(Number(t) * 1000) / 100000;
}
