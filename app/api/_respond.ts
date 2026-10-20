import { NextResponse } from "next/server";
import { EditError } from "@/lib/ledger/edit";

/** Run a write and turn its outcome into JSON. */
export async function respond<T>(fn: () => Promise<T>): Promise<NextResponse> {
  try {
    return NextResponse.json((await fn()) ?? { ok: true });
  } catch (e) {
    if (e instanceof EditError) return NextResponse.json({ error: e.message, deal: e.current }, { status: e.status });
    console.error("write failed", e);
    return NextResponse.json({ error: "Couldn't save. Try again." }, { status: 500 });
  }
}

export const body = (req: Request) => req.json().catch(() => null);
