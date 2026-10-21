"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import type { Role } from "@/lib/session";
import type { AppUser } from "@/lib/users";
import Modal from "../Modal";

const ROLE_LABEL: Record<Role, string> = { admin: "Admin", sales: "Sales rep", installer: "Installer" };
const ROLE_SEES: Record<Role, string> = {
  admin: "Everything",
  sales: "Sales form and their own commissions",
  installer: "Installer form and their own commissions",
};

/** 12 characters, no look-alikes, easy to read out over the phone. */
function makePassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const a = new Uint32Array(12);
  crypto.getRandomValues(a);
  return [...a].map((n) => chars[n % chars.length]).join("").replace(/(.{4})(?=.)/g, "$1-");
}

async function send(url: string, method: string, payload: unknown): Promise<string | null> {
  try {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (res.ok) return null;
    const b = (await res.json().catch(() => ({}))) as { error?: string };
    return b.error ?? "Couldn't save.";
  } catch {
    return "Couldn't reach the server.";
  }
}

interface BulkResult {
  created: Array<{ name: string; email: string; role: "sales" | "installer"; password: string }>;
  skipped: Array<{ name: string; reason: string }>;
}

function BulkCard({ r, onDone }: { r: BulkResult; onDone: () => void }) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const text = r.created.map((c) => `${c.name}: sign in at ${origin}/login with ${c.email} / ${c.password}`).join("\n");
  const [copied, setCopied] = useState(false);
  return (
    <section className="credential bulk">
      <div className="bulk-head">
        <strong>{r.created.length === 0 ? "No new logins" : `Created ${r.created.length} login${r.created.length === 1 ? "" : "s"}. Send each person theirs.`}</strong>
        <span className="muted">These passwords won&apos;t be shown again.</span>
      </div>
      {r.created.length > 0 && (
        <table>
          <thead><tr><th>Name</th><th>Role</th><th>Email</th><th>Password</th></tr></thead>
          <tbody>
            {r.created.map((c) => (
              <tr key={c.email}><td><strong>{c.name}</strong></td><td>{ROLE_LABEL[c.role]}</td><td>{c.email}</td><td><code>{c.password}</code></td></tr>
            ))}
          </tbody>
        </table>
      )}
      {r.skipped.length > 0 && (
        <ul className="bulk-skipped">
          {r.skipped.map((s) => <li key={s.name + s.reason}><strong>{s.name}</strong>: {s.reason}</li>)}
        </ul>
      )}
      <div className="bulk-actions">
        {r.created.length > 0 && (
          <button type="button" className="btn-outline" onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true))}>{copied ? "Copied" : "Copy all"}</button>
        )}
        <button type="button" className="linkbtn" onClick={onDone}>Done</button>
      </div>
    </section>
  );
}

export default function TeamView({ users, people }: { users: AppUser[]; people: Array<{ id: string; name: string; roles: string[] }> }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<AppUser | null>(null);
  const [shown, setShown] = useState<{ email: string; password: string } | null>(null);
  const closeAdd = useCallback(() => setAdding(false), []);
  const closeEdit = useCallback(() => setEditing(null), []);
  const [bulk, setBulk] = useState<BulkResult | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const fromCalendar = async () => {
    setBulkBusy(true);
    setBulkError(null);
    try {
      const res = await fetch("/api/users/from-calendar", { method: "POST" });
      const j = (await res.json().catch(() => ({}))) as BulkResult & { error?: string };
      if (!res.ok) setBulkError(j.error ?? "Couldn't create the logins.");
      else {
        setBulk(j);
        router.refresh();
      }
    } catch {
      setBulkError("Couldn't reach the server.");
    }
    setBulkBusy(false);
  };

  return (
    <>
      <div className="table-bar">
        <button type="button" className="btn-primary" onClick={() => setAdding(true)}>+ Add login</button>
        <button type="button" className="btn-outline" disabled={bulkBusy} onClick={() => void fromCalendar()}>{bulkBusy ? "Creating…" : "Create logins from calendar"}</button>
        <span className="muted">Admins sign in with the owner password (leave email blank) until they have their own login.</span>
      </div>

      {bulkError && <p className="flash" role="alert">{bulkError}</p>}
      {bulk && <BulkCard r={bulk} onDone={() => setBulk(null)} />}

      {shown && (
        <div className="credential">
          <div>
            <strong>Send these to them:</strong> sign in at <code>{typeof window !== "undefined" ? window.location.origin : ""}/login</code> with
            <code>{shown.email}</code> and password <code>{shown.password}</code>
          </div>
          <span className="muted">This password won&apos;t be shown again.</span>
          <button type="button" className="linkbtn" onClick={() => setShown(null)}>Done</button>
        </div>
      )}

      {users.length === 0 ? (
        <p className="empty">No logins yet. Add one for each rep and installer; they&apos;ll only see their own form and commissions.</p>
      ) : (
        <div className="tablewrap">
          <table>
            <thead>
              <tr><th>Name</th><th>Email</th><th>Role</th><th>Sees</th><th>Roster person</th><th>Last sign-in</th><th /></tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={u.active ? "" : "muted"}>
                  <td><strong>{u.name}</strong>{!u.active && <span className="pill past"> off</span>}</td>
                  <td>{u.email}</td>
                  <td><span className={`role-pill r-${u.role}`}>{ROLE_LABEL[u.role]}</span></td>
                  <td className="muted">{ROLE_SEES[u.role]}</td>
                  <td>{u.personName ?? <span className="muted">—</span>}</td>
                  <td className="muted">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) : "never"}</td>
                  <td><button type="button" className="btn-outline" onClick={() => setEditing(u)}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding && (
        <UserModal
          people={people}
          onClose={closeAdd}
          onSaved={(email, password) => {
            setAdding(false);
            if (password) setShown({ email, password });
            router.refresh();
          }}
        />
      )}
      {editing && (
        <UserModal
          user={editing}
          people={people}
          onClose={closeEdit}
          onSaved={(email, password) => {
            setEditing(null);
            if (password) setShown({ email, password });
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function UserModal({ user, people, onClose, onSaved }: {
  user?: AppUser;
  people: Array<{ id: string; name: string; roles: string[] }>;
  onClose: () => void;
  onSaved: (email: string, password: string | null) => void;
}) {
  const [role, setRole] = useState<Role>(user?.role ?? "sales");
  const [personId, setPersonId] = useState(user?.personId ?? "");
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [password, setPassword] = useState(user ? "" : makePassword());
  const [active, setActive] = useState(user?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wantRole = role === "installer" ? "installer" : role === "sales" ? "closer" : null;
  const sorted = [...people].sort((a, b) => Number(!!wantRole && b.roles.includes(wantRole)) - Number(!!wantRole && a.roles.includes(wantRole)) || a.name.localeCompare(b.name));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const payload = user
      ? { name, email, role, personId: personId || null, active, ...(password ? { password } : {}) }
      : { name, email, role, personId: personId || null, password };
    const err = await send(user ? `/api/users/${user.id}` : "/api/users", user ? "PATCH" : "POST", payload);
    setBusy(false);
    if (err) return setError(err);
    onSaved(email.trim().toLowerCase(), password || null);
  }

  return (
    <Modal title={user ? `Edit ${user.name}` : "Add a login"} onClose={onClose} width={560}>
      <form className="pay-form" onSubmit={submit}>
        <label>What can they see?
          <div className="seg" role="radiogroup" aria-label="Role">
            {(["sales", "installer", "admin"] as Role[]).map((r) => (
              <button key={r} type="button" role="radio" aria-checked={role === r} className={role === r ? "on" : ""} onClick={() => setRole(r)}>{ROLE_LABEL[r]}</button>
            ))}
          </div>
        </label>
        <p className="muted small">{ROLE_SEES[role]}.</p>
        <div className="grid">
          <label>Roster person{role === "admin" ? " (optional)" : ""}
            <select
              value={personId}
              onChange={(e) => {
                setPersonId(e.target.value);
                const p = people.find((x) => x.id === e.target.value);
                if (p && !name) setName(p.name);
              }}
              required={role !== "admin"}
            >
              <option value="">{role === "admin" ? "None" : "Choose…"}</option>
              {sorted.map((p) => <option key={p.id} value={p.id}>{p.name}{p.roles.length ? ` (${p.roles.join(", ")})` : ""}</option>)}
            </select>
          </label>
          <label>Name<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
          <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="off" /></label>
          <label>{user ? "New password (optional)" : "Password"}
            <span className="pw-row">
              <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder={user ? "Leave blank to keep" : ""} autoComplete="new-password" minLength={8} required={!user} />
              <button type="button" className="linkbtn" onClick={() => setPassword(makePassword())}>Generate</button>
            </span>
          </label>
        </div>
        {user && (
          <label className="check-row">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Login is active
          </label>
        )}
        {user && <p className="muted small">Changing the role or person, a new password, or turning the login off signs them out everywhere.</p>}
        {error && <p className="flash">{error}</p>}
        <div className="products-actions">
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? "Saving…" : user ? "Save" : "Add login"}</button>
        </div>
      </form>
    </Modal>
  );
}
