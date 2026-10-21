import { DAYS_PER_WEEK, SLOTS_PER_DAY, loadCapacity, syncCapacityMembers } from "@/lib/capacity";
import { todayET } from "@/lib/dates";
import CapacityView from "./CapacityView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Capacity" };

export default async function CapacityPage() {
  const today = todayET();
  // Anyone newly booked on the GHL calendars joins their location's team.
  await syncCapacityMembers(today).catch((e) => console.error("capacity sync failed", e));
  const cap = await loadCapacity(today);
  return (
    <>
      <div className="page-head">
        <h1>Capacity</h1>
      </div>
      <p className="muted cap-rule">
        Each rep has {SLOTS_PER_DAY.sales} sales appointments a day and each installer {SLOTS_PER_DAY.install} installs a day, {DAYS_PER_WEEK} days a week.
        Booked comes from the GoHighLevel calendars.
      </p>
      {cap.problems.length > 0 && <ul className="report-flags">{cap.problems.map((p, i) => <li key={i}>{p.location}: {p.message}</li>)}</ul>}
      <CapacityView locations={cap.locations} weeks={cap.weeks} />
    </>
  );
}
