import { NextResponse } from "next/server";
import { currentSession } from "@/lib/auth";
import { loadCustomer } from "@/lib/customers";
import { todayET } from "@/lib/dates";

export const dynamic = "force-dynamic";

/** The customer profile as JSON, for the ledger popup. */
export async function GET(_req: Request, { params }: { params: { key: string } }) {
  const s = await currentSession();
  if (!s) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  const p = await loadCustomer(params.key, { role: s.role, personId: s.personId }, todayET());
  if (!p) return NextResponse.json({ error: "Customer not found." }, { status: 404 });
  return NextResponse.json(p);
}
