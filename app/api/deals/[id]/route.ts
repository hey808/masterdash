import { NextResponse, type NextRequest } from "next/server";
import { EditError, applyEdit } from "@/lib/ledger/edit";
import { EditRequest, type FieldKey } from "@/lib/ledger/fields";

export const dynamic = "force-dynamic";

/** PATCH /api/deals/:id  { field, value, version } → { deal } */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = EditRequest.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message ?? "Bad request" }, { status: 400 });
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ error: "Bad deal id" }, { status: 400 });

  try {
    // Shared password for now, so every web edit is attributed to the ledger UI.
    const deal = await applyEdit(params.id, body.data.field as FieldKey, body.data.value, body.data.version, "web:ledger");
    return NextResponse.json({ deal });
  } catch (e) {
    if (e instanceof EditError) return NextResponse.json({ error: e.message, deal: e.current }, { status: e.status });
    console.error("ledger edit failed", e);
    return NextResponse.json({ error: "Couldn't save. Try again." }, { status: 500 });
  }
}
