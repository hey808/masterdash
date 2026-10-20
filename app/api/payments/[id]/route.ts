import type { NextRequest } from "next/server";
import { redatePayment, removePayment } from "@/lib/ledger/money-events";
import { body, respond } from "../../_respond";

export const dynamic = "force-dynamic";

/** PATCH /api/payments/:id  { receivedOn } → { deal } */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const input = await body(req);
  return respond(async () => ({ deal: await redatePayment(params.id, input, "web:ledger") }));
}

/** DELETE /api/payments/:id → { deal } */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  return respond(async () => ({ deal: await removePayment(params.id, "web:ledger") }));
}
