import { loadCapacity } from "@/lib/capacity";
import { todayET } from "@/lib/dates";
import { locationUsers } from "@/lib/ghl";
import { loadOptions } from "@/lib/ledger/options";
import CapacityView from "./CapacityView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Capacity" };

export default async function CapacityPage({ searchParams }: { searchParams: { loc?: string; week?: string } }) {
  const today = todayET();
  const [cap, options] = await Promise.all([loadCapacity(today), loadOptions()]);
  const loc = cap.locations.find((l) => l.slug === searchParams.loc) ?? cap.locations[0];
  if (!loc) return <h1>Capacity</h1>;
  const weekIdx = Math.max(0, cap.weeks.indexOf(searchParams.week ?? ""));
  const ghlUsers = await locationUsers(loc.slug);
  return (
    <>
      <div className="page-head">
        <h1>Capacity</h1>
      </div>
      <nav className="tabs">
        {cap.locations.map((l) => (
          <a key={l.slug} href={`/capacity?loc=${l.slug}`} className={l.slug === loc.slug ? "on" : ""} aria-current={l.slug === loc.slug ? "page" : undefined}>
            {l.name}
          </a>
        ))}
      </nav>
      {cap.problems.length > 0 && (
        <ul className="report-flags">
          {cap.problems.map((p, i) => <li key={i}>{p.location}: {p.message}</li>)}
        </ul>
      )}
      <CapacityView loc={loc} weeks={cap.weeks} weekIdx={weekIdx} people={options.people} ghlUsers={ghlUsers} today={today} />
    </>
  );
}
