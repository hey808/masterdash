import { NextResponse, type NextRequest } from "next/server";
import { signAgreement } from "@/lib/agreements";
import { EditError } from "@/lib/ledger/edit";

export const dynamic = "force-dynamic";

/**
 * Public: the customer signs. The secret token in the link is the only key, so
 * this never uses the app's sign-in. Records where and how it was signed.
 */
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const input = await req.json().catch(() => null);
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;
    await signAgreement(params.token, input, { ip, userAgent: req.headers.get("user-agent") });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof EditError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("sign failed", e);
    return NextResponse.json({ error: "Couldn't save your signature. Try again." }, { status: 500 });
  }
}
