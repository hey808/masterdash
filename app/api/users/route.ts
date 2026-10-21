import type { NextRequest } from "next/server";
import { createUser } from "@/lib/users";
import { body, respond } from "../_respond";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const input = await body(req);
  return respond(() => createUser(input, "web:team"));
}
