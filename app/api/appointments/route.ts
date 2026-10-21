import type { NextRequest } from "next/server";
import { recordDisposition } from "@/lib/appointments";
import { currentSession } from "@/lib/auth";
import { body, respond } from "../_respond";

export const dynamic = "force-dynamic";

/** POST { appointmentId, day, outcome: "declined" | "rescheduled", reason?, note?, rescheduledTo? } */
export async function POST(req: NextRequest) {
  const input = await body(req);
  return respond(async () => {
    const s = await currentSession();
    return recordDisposition(input, { personId: s?.personId ?? null, isAdmin: s?.role === "admin", actor: `web:appointments:${s?.userId ?? "?"}` });
  });
}
