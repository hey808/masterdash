export const dynamic = "force-dynamic";

export default function LoginPage({ searchParams }: { searchParams: { next?: string; error?: string; email?: string } }) {
  const error =
    searchParams.error === "wrong"
      ? "That email and password don't match."
      : searchParams.error === "unset"
        ? "Sign-in isn't set up on the server (APP_PASSWORD)."
        : null;
  return (
    <section className="login">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/shield.png" alt="" width={72} height={73} className="login-shield" />
      <h1>Sign in</h1>
      <form method="post" action="/api/login">
        <input type="hidden" name="next" value={searchParams.next ?? ""} />
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="username" defaultValue={searchParams.email ?? ""} autoFocus={!searchParams.email} />
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" autoFocus={!!searchParams.email} required />
        {error && <p className="error">{error}</p>}
        <button type="submit">Sign in</button>
      </form>
    </section>
  );
}
