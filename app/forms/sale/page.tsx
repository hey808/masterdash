import { todayET } from "@/lib/dates";
import { loadStock } from "@/lib/inventory";
import { loadOptions } from "@/lib/ledger/options";
import SaleForm from "./SaleForm";

export const dynamic = "force-dynamic";

export default async function SaleFormPage() {
  const options = await loadOptions();
  const open = options.locations.filter((l) => l.active);
  const stock: Record<string, Record<string, number>> = {};
  for (const l of open) {
    stock[l.slug] = Object.fromEntries((await loadStock(l.slug)).map((r) => [r.skuCode, r.available]));
  }
  return (
    <>
      <p className="crumb"><a href="/forms">Forms</a> / Sales form</p>
      <h1>Sales form</h1>
      <SaleForm options={options} stock={stock} today={todayET()} />
    </>
  );
}
