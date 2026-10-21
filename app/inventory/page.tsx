import { todayET } from "@/lib/dates";
import { loadPurchaseOrders, loadStock } from "@/lib/inventory";
import { loadOptions } from "@/lib/ledger/options";
import InventoryView from "./InventoryView";

export const dynamic = "force-dynamic";

export default async function InventoryPage({ searchParams }: { searchParams: { loc?: string } }) {
  const options = await loadOptions();
  const open = options.locations.filter((l) => l.active);
  const loc = open.find((l) => l.slug === searchParams.loc)?.slug ?? open[0]?.slug ?? "wilmington";
  const [stock, pos] = await Promise.all([loadStock(loc), loadPurchaseOrders(loc)]);
  return (
    <>
      <h1>Inventory</h1>
      <nav className="tabs">
        {open.map((l) => (
          <a key={l.slug} href={`/inventory?loc=${l.slug}`} className={l.slug === loc ? "on" : ""}>
            {l.name}
          </a>
        ))}
      </nav>
      <InventoryView
        location={loc}
        locationName={open.find((l) => l.slug === loc)?.name ?? loc}
        stock={stock}
        pos={pos}
        skus={options.skus}
        today={todayET()}
      />
    </>
  );
}
