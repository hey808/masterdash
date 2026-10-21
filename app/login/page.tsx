export const dynamic = "force-dynamic";

export default function LoginPage({ searchParams }: { searchParams: { next?: string; error?: string } }) {
  const error =
    searchParams.error === "wrong" ? "That password didn't work." : searchParams.error === "unset" ? "APP_PASSWORD isn't set on the server." : null;
  return (
    <section className="login">
      <h1>Sign in</h1>
      <form method="post" action="/api/login">
        <input type="hidden" name="next" value={searchParams.next ?? "/ledger"} />
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" autoFocus required />
        {error && <p className="error">{error}</p>}
        <button type="submit">Sign in</button>
      </form>
    </section>
  );
}
