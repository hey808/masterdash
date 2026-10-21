import type { NextRequest } from "next/server";
import { importBankCsv } from "@/lib/bank";
import { body, respond } from "../../_respond";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const input = await body(req);
  return respond(() => importBankCsv(input));
}
