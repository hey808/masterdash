import type { NextRequest } from "next/server";
import { updateUser } from "@/lib/users";
import { body, respond } from "../../_respond";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const input = await body(req);
  return respond(() => updateUser(params.id, input, "web:team"));
}
