import type { NextRequest } from "next/server";
import { removePayout } from "@/lib/ledger/money-events";
import { respond } from "../../_respond";

export const dynamic = "force-dynamic";

/** DELETE /api/payouts/:id  (undo a payout recorded here; imported history is protected) */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  return respond(async () => {
    await removePayout(params.id, "web:commissions");
    return { ok: true };
  });
}
