import { NextResponse, type NextRequest } from "next/server";
import { currentSession } from "@/lib/auth";
import { loadCategories, loadTransactions } from "@/lib/bank";
import { filterTxns, isBankSort, sortTxns, toCsv, type BankFilter } from "@/lib/bank-export";

export const dynamic = "force-dynamic";

const day = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);

/** GET /bank/export?filter=&category=&q=&from=&to= → CSV download (office only; the middleware already limits /bank). */
export async function GET(req: NextRequest) {
  const s = await currentSession();
  if (!s || s.role !== "admin") return new NextResponse("Not found", { status: 404 });
  const p = req.nextUrl.searchParams;
  const filter = (["all", "review", "in", "out"].includes(p.get("filter") ?? "") ? p.get("filter") : "all") as BankFilter;
  const from = day(p.get("from"));
  const to = day(p.get("to"));
  const [txns, cats] = await Promise.all([loadTransactions({ from, to }), loadCategories()]);
  const names = new Map(cats.map((c) => [c.slug, c.name]));
  const sort = p.get("sort");
  const rows0 = filterTxns(txns, { filter, category: p.get("category") || null, q: p.get("q") || null, from, to });
  const rows = sortTxns(rows0, isBankSort(sort) ? sort : "date-desc");
  const name = `clearflow-bank${from ? `-${from}` : ""}${to ? `-to-${to}` : ""}${filter !== "all" ? `-${filter}` : ""}.csv`;
  return new NextResponse(toCsv(rows, (slug) => names.get(slug) ?? slug), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
