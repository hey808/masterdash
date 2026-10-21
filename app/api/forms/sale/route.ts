import type { NextRequest } from "next/server";
import { submitSale } from "@/lib/forms";
import { currentSession } from "@/lib/auth";
import { body, respond } from "../../_respond";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const input = (await body(req)) as Record<string, unknown> | null;
  const session = await currentSession();
  // A sales can only submit as themselves, whatever the request says.
  if (input && session && session.role !== "admin") input.closerId = session.personId;
  return respond(() => submitSale(input));
}
