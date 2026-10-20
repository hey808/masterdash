import type { NextRequest } from "next/server";
import { recordPayout } from "@/lib/ledger/money-events";
import { body, respond } from "../_respond";

export const dynamic = "force-dynamic";

/** POST /api/payouts  { dealId, kind, personId, amountCents, paidOn } */
export async function POST(req: NextRequest) {
  const input = await body(req);
  return respond(() => recordPayout(input, "web:commissions"));
}
