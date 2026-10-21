import { NextResponse } from "next/server";
import { agreementPdf } from "@/lib/agreement-pdf";
import { loadAgreement } from "@/lib/agreements";
import { currentSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** The office (or the agreement's rep) downloads it. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const s = await currentSession();
  const a = await loadAgreement(params.id);
  if (!s || !a || (s.role !== "admin" && a.repId !== s.personId)) return new NextResponse("Not found", { status: 404 });
  const pdf = await agreementPdf(a);
  return new NextResponse(Buffer.from(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="Clearflow-Agreement-${a.number}.pdf"`, "Cache-Control": "private, no-store" },
  });
}
