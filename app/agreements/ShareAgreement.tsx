"use client";

import { useEffect, useState } from "react";

/** After saving (and on an agreement's page): get it in front of the customer. */
export default function ShareAgreement({ id, token, number, name, phone, email, fresh }: { id: string; token: string; number: string; name: string; phone: string | null; email: string | null; fresh?: boolean }) {
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => setOrigin(window.location.origin), []);
  const link = `${origin}/c/${token}`;
  const first = name.split(" ")[0] || "there";
  const msg = `Hi ${first}, here is your Clearflow Water agreement to review and sign: ${link}`;
  const tel = (phone ?? "").replace(/[^\d+]/g, "");
  return (
    <section className="agr-share">
      {fresh && (
        <div className="agr-share-head">
          <h2>Agreement {number} is ready</h2>
          <p className="muted">Sign it here with {first}, or send them the link.</p>
        </div>
      )}
      <a className="btn-primary big agr-share-main" href={`/c/${token}`}>Sign now on this device</a>
      {tel && <a className="dispo-btn" href={`sms:${tel}?&body=${encodeURIComponent(msg)}`}>Text the link to {phone}</a>}
      {email && <a className="dispo-btn" href={`mailto:${email}?subject=${encodeURIComponent(`Your Clearflow Water agreement (${number})`)}&body=${encodeURIComponent(msg)}`}>Email the link to {email}</a>}
      <button type="button" className="dispo-btn" onClick={() => void navigator.clipboard.writeText(link).then(() => setCopied(true))}>{copied ? "Link copied" : "Copy link"}</button>
      {fresh && <a className="linkbtn agr-share-done" href={`/agreements/${id}`}>Done</a>}
    </section>
  );
}
