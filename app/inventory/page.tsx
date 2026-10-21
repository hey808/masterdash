import { todayET } from "@/lib/dates";
import { loadPurchaseOrders, loadStock } from "@/lib/inventory";
import { loadOptions } from "@/lib/ledger/options";
import InventoryView from "./InventoryView";

export const dynamic = "force-dynamic";

const ALL = "all";

export default async function InventoryPage({ searchParams }: { searchParams: { loc?: string } }) {
  const options = await loadOptions();
  const open = options.locations.filter((l) => l.active);
  // Combined is the default; a location tab narrows to that warehouse.
  const loc = open.find((l) => l.slug === searchParams.loc)?.slug ?? null;
  const [stock, pos] = await Promise.all([loadStock(loc), loadPurchaseOrders(loc)]);
  const tabs = [{ slug: ALL, name: "Combined" }, ...open];
  return (
    <>
      <h1>Inventory</h1>
      <nav className="tabs">
        {tabs.map((l) => {
          const on = l.slug === (loc ?? ALL);
          return (
            <a key={l.slug} href={l.slug === ALL ? "/inventory" : `/inventory?loc=${l.slug}`} className={on ? "on" : ""} aria-current={on ? "page" : undefined}>
              {l.name}
            </a>
          );
        })}
      </nav>
      <InventoryView
        location={loc}
        locations={open.map(({ slug, name }) => ({ slug, name }))}
        locationName={loc ? (open.find((l) => l.slug === loc)?.name ?? loc) : "all locations"}
        stock={stock}
        pos={pos}
        skus={options.skus}
        today={todayET()}
      />
    </>
  );
}
