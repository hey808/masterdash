import { NextResponse } from "next/server";
import { EditError } from "@/lib/ledger/edit";

/** Run a write and turn its outcome into JSON. */
export async function respond<T>(fn: () => Promise<T>): Promise<NextResponse> {
  try {
    return NextResponse.json((await fn()) ?? { ok: true });
  } catch (e) {
    if (e instanceof EditError) return NextResponse.json({ error: e.message, deal: e.current }, { status: e.status });
    // Postgres said no: bad input or a rule the data has to follow. That's the request, not the server.
    const code = (e as { code?: string }).code ?? "";
    if (code === "22P02" || code === "22007" || code === "22008") return NextResponse.json({ error: "Something in that request isn't in the right format." }, { status: 400 });
    if (code === "23503") return NextResponse.json({ error: "That refers to something that no longer exists. Reload and try again." }, { status: 400 });
    if (code === "23505") return NextResponse.json({ error: "That's already been recorded." }, { status: 409 });
    if (code.startsWith("23")) return NextResponse.json({ error: "That would break one of the ledger's rules, so it wasn't saved." }, { status: 400 });
    if (code === "40001" || code === "40P01") return NextResponse.json({ error: "Someone else saved at the same moment. Try again." }, { status: 409 });
    console.error("write failed", e);
    return NextResponse.json({ error: "Couldn't save. Try again." }, { status: 500 });
  }
}

export const body = (req: Request) => req.json().catch(() => null);
