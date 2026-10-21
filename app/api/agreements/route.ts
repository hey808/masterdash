import type { NextRequest } from "next/server";
import { createAgreement } from "@/lib/agreements";
import { currentSession } from "@/lib/auth";
import { body, respond } from "../_respond";

export const dynamic = "force-dynamic";

/** POST: prepare an agreement and lock it for the customer's signature. Reps are always the representative. */
export async function POST(req: NextRequest) {
  const input = (await body(req)) as Record<string, unknown> | null;
  const s = await currentSession();
  if (input && s && s.role !== "admin") input.repId = s.personId;
  return respond(() => createAgreement(input, `web:agreements:${s?.userId ?? "?"}`));
}
