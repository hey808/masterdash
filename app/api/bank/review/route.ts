import type { NextRequest } from "next/server";
import { z } from "zod";
import { markReviewed } from "@/lib/bank";
import { EditError } from "@/lib/ledger/edit";
import { body, respond } from "../../_respond";

export const dynamic = "force-dynamic";

const Req = z.object({ ids: z.array(z.string().uuid()).min(1).max(1000) });

export async function POST(req: NextRequest) {
  const input = Req.safeParse(await body(req));
  return respond(async () => {
    if (!input.success) throw new EditError("Nothing to mark.", 400);
    return { updated: await markReviewed(input.data.ids) };
  });
}
