import { accountBalances, loadCategories, loadTransactions } from "@/lib/bank";
import { todayET } from "@/lib/dates";
import BankView from "./BankView";

export const dynamic = "force-dynamic";

export default async function BankPage() {
  const today = todayET();
  const [txns, cats, balances] = await Promise.all([loadTransactions(), loadCategories(), accountBalances(today)]);
  return (
    <>
      <h1>Bank</h1>
      <BankView txns={txns} categories={cats} balances={balances} />
    </>
  );
}
