import { draftFromAppointment, draftFromDeal, emptyDraft } from "@/lib/agreement-prefill";
import { currentSession } from "@/lib/auth";
import { todayET } from "@/lib/dates";
import { loadOptions } from "@/lib/ledger/options";
import AgreementForm from "../AgreementForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "New customer agreement" };

export default async function NewAgreementPage({ searchParams }: { searchParams: { deal?: string; appt?: string; day?: string } }) {
  const session = await currentSession();
  const rep = session && session.role !== "admin" ? { personId: session.personId ?? "", name: session.name } : null;
  const today = todayET();
  const day = searchParams.day && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.day) ? searchParams.day : today;
  const [options, fromDeal, fromAppt] = await Promise.all([
    loadOptions(),
    searchParams.deal && /^[0-9a-f-]{36}$/.test(searchParams.deal) ? draftFromDeal(searchParams.deal) : Promise.resolve(null),
    searchParams.appt ? draftFromAppointment(searchParams.appt, day, rep?.personId ?? null).catch(() => null) : Promise.resolve(null),
  ]);
  const draft = fromDeal ?? fromAppt ?? emptyDraft();
  const reps = options.people.filter((p) => p.roles.includes("closer") || p.roles.includes("manager"));
  return (
    <div className="agr-page">
      <p className="crumb"><a href="/agreements">Agreements</a> / New</p>
      <h1>Customer agreement</h1>
      {draft.dealNumber != null && <p className="muted">Filled in from deal #{draft.dealNumber}. Check everything with the customer.</p>}
      <AgreementForm draft={draft} reps={reps} me={rep} lenders={options.lenders} today={today} />
    </div>
  );
}
