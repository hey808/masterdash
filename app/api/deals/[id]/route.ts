import { NextResponse, type NextRequest } from "next/server";
import { EditError, applyEdit } from "@/lib/ledger/edit";
import { EditRequest, type FieldKey } from "@/lib/ledger/fields";
import { currentSession } from "@/lib/auth";
import { deleteDeal, deleteImpact } from "@/lib/ledger/delete";

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

/** GET /api/deals/:id?impact=1 → what deleting it would remove. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const s = await currentSession();
  if (s?.role !== "admin") return NextResponse.json({ error: "Office only." }, { status: 403 });
  if (!req.nextUrl.searchParams.has("impact")) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const i = await deleteImpact(params.id);
  return i ? NextResponse.json(i) : NextResponse.json({ error: "Unknown deal." }, { status: 404 });
}

/** DELETE /api/deals/:id  { confirm: <deal number> } → permanently deletes it (office only). */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const s = await currentSession();
  if (s?.role !== "admin") return NextResponse.json({ error: "Only the office can delete deals." }, { status: 403 });
  try {
    const removed = await deleteDeal(params.id, await req.json().catch(() => null), `web:ledger:delete:${s.userId}`);
    return NextResponse.json({ ok: true, removed });
  } catch (e) {
    if (e instanceof EditError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("deal delete failed", e);
    return NextResponse.json({ error: "Couldn't delete it. Try again." }, { status: 500 });
  }
}
