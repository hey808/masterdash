import type { NextRequest } from "next/server";
import { submitFunding } from "@/lib/forms";
import { body, respond } from "../../_respond";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const input = await body(req);
  return respond(() => submitFunding(input));
}
