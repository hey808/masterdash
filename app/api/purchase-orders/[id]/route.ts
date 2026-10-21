import type { NextRequest } from "next/server";
import { setPurchaseOrderStatus } from "@/lib/inventory";
import { body, respond } from "../../_respond";

export const dynamic = "force-dynamic";

/** POST { action: "receive" | "cancel" | "reopen", receivedOn? } */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const input = await body(req);
  return respond(async () => {
    await setPurchaseOrderStatus(params.id, input);
    return { ok: true };
  });
}
