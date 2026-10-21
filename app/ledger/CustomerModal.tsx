"use client";

import { useEffect, useState } from "react";
import type { CustomerProfile } from "@/lib/customer-types";
import Modal from "../Modal";
import CustomerProfileView from "../customers/CustomerProfileView";

/** The customer's profile over the ledger. */
export default function CustomerModal({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const [p, setP] = useState<CustomerProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/customers/${id}`)
      .then(async (r) => {
        const b = await r.json().catch(() => ({}));
        if (!live) return;
        if (r.ok) setP(b as CustomerProfile);
        else setError((b as { error?: string }).error ?? "Couldn't load the customer.");
      })
      .catch(() => live && setError("Couldn't reach the server."));
    return () => {
      live = false;
    };
  }, [id]);
  return (
    <Modal title={name} onClose={onClose} width={860}>
      <div className="cust-modal">
        {error ? <p className="flash">{error}</p> : p ? <CustomerProfileView p={p} compact /> : <p className="muted cust-loading">Loading everything on {name}…</p>}
        <p className="cust-modal-foot"><a href={`/customers/${id}`}>Open full page</a></p>
      </div>
    </Modal>
  );
}
