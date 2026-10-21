"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function VoidAgreement({ id }: { id: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!open) return <button type="button" className="linkbtn danger" onClick={() => setOpen(true)}>Cancel agreement</button>;
  return (
    <div className="agr-void">
      <label>Why is it being cancelled?<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. wrong price, customer changed system" /></label>
      {error && <p className="flash">{error}</p>}
      <div className="row-actions">
        <button
          type="button"
          className="btn-primary"
          disabled={busy || reason.trim().length < 3}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const res = await fetch(`/api/agreements/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "void", reason }) }).catch(() => null);
            setBusy(false);
            if (!res?.ok) return setError(((await res?.json().catch(() => ({}))) as { error?: string })?.error ?? "Couldn't cancel it.");
            router.refresh();
          }}
        >
          Cancel agreement
        </button>
        <button type="button" className="linkbtn" onClick={() => setOpen(false)}>Keep it</button>
      </div>
    </div>
  );
}
