import { redirect } from "next/navigation";

/** Agreements live on each customer now. */
export default function AgreementsPage() {
  redirect("/customers");
}
