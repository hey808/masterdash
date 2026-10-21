export const dynamic = "force-dynamic";

export default function FormsPage() {
  return (
    <>
      <h1>Forms</h1>
      <div className="form-cards">
        <a className="form-card" href="/forms/sale">
          <span className="form-card-kicker">Closer</span>
          <span className="form-card-title">Sales form</span>
        </a>
        <a className="form-card" href="/forms/install">
          <span className="form-card-kicker">Installer</span>
          <span className="form-card-title">Installer form</span>
        </a>
      </div>
    </>
  );
}
