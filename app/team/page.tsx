import { loadOptions } from "@/lib/ledger/options";
import { listUsers } from "@/lib/users";
import TeamView from "./TeamView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Team" };

export default async function TeamPage() {
  const [users, options] = await Promise.all([listUsers(), loadOptions()]);
  return (
    <>
      <div className="page-head">
        <h1>Team logins</h1>
      </div>
      <TeamView users={users} people={options.people} />
    </>
  );
}
