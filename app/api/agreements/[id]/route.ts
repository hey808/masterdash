import type { NextRequest } from "next/server";
import { loadAgreement, voidAgreement } from "@/lib/agreements";
import { currentSession } from "@/lib/auth";
import { EditError } from "@/lib/ledger/edit";
import { body, respond } from "../../_respond";

export const dynamic = "force-dynamic";

/** POST { action: "void", reason }: cancel it. Reps can cancel their own unsigned ones; the office any. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const input = (await body(req)) as { action?: string; reason?: string } | null;
  return respond(async () => {
    const s = await currentSession();
    const a = await loadAgreement(params.id);
    if (!a || (s?.role !== "admin" && a.repId !== s?.personId)) throw new EditError("Unknown agreement.", 404);
    if (input?.action !== "void") throw new EditError("Unknown action.", 400);
    if (a.status === "signed" && s?.role !== "admin") throw new EditError("A signed agreement can only be cancelled by the office.", 400);
    await voidAgreement(a.id, input.reason ?? "", `web:agreements:${s?.userId ?? "?"}`);
    return { ok: true };
  });
}
