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

export default function TeamView({ users, people }: { users: AppUser[]; people: Array<{ id: string; name: string; roles: string[] }> }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<AppUser | null>(null);
  const [shown, setShown] = useState<{ email: string; password: string } | null>(null);
  const closeAdd = useCallback(() => setAdding(false), []);
  const closeEdit = useCallback(() => setEditing(null), []);

  return (
    <>
      <div className="table-bar">
        <button type="button" className="btn-primary" onClick={() => setAdding(true)}>+ Add login</button>
        <span className="muted">Admins sign in with the owner password (leave email blank) until they have their own login.</span>
      </div>

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
