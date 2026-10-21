import { NextResponse } from "next/server";
import { agreementPdf } from "@/lib/agreement-pdf";
import { loadAgreementByToken } from "@/lib/agreements";

export const dynamic = "force-dynamic";

/** Public: the customer's copy, by the secret link. */
export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const a = await loadAgreementByToken(params.token);
  if (!a) return new NextResponse("Not found", { status: 404 });
  const pdf = await agreementPdf(a);
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Clearflow-Agreement-${a.number}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
