import type { NextRequest } from "next/server";
import { recordPayment } from "@/lib/ledger/money-events";
import { body, respond } from "../../../_respond";

export const dynamic = "force-dynamic";

/** POST /api/deals/:id/payments  { source, method, amountCents, feeCents, receivedOn } → { deal } */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const input = await body(req);
  return respond(async () => ({ deal: await recordPayment(params.id, input, "web:ledger") }));
}
