"use client";

import { useState } from "react";
import POForm from "../../inventory/POForm";

export default function POPage(props: { locations: Array<{ slug: string; name: string }>; skus: Array<{ code: string; name: string; costCents?: number }>; today: string }) {
  const [saved, setSaved] = useState<number | null>(null);
  const [n, setN] = useState(0); // remounts the form for the next order
  return (
    <section className="form-panel">
      {saved != null && (
        <p className="saved-note" role="status">
          PO #{saved} saved. It shows in <a href="/inventory">Inventory</a> as on order until it&apos;s marked received.
        </p>
      )}
      <POForm key={n} location={null} {...props} onDone={(po) => { setSaved(po.number); setN((x) => x + 1); window.scrollTo({ top: 0 }); }} />
    </section>
  );
}
