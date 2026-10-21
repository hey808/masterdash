import { todayET } from "@/lib/dates";
import { loadOptions } from "@/lib/ledger/options";
import POPage from "./POPage";

export const dynamic = "force-dynamic";
export const metadata = { title: "Purchase order form" };

export default async function PurchaseOrderFormPage() {
  const options = await loadOptions();
  const locations = options.locations.filter((l) => l.active).map(({ slug, name }) => ({ slug, name }));
  return (
    <>
      <p className="crumb"><a href="/forms">Forms</a> / Purchase order form</p>
      <h1>Purchase order form</h1>
      <POPage locations={locations} skus={options.skus} today={todayET()} />
    </>
  );
}
