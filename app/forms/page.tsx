export const dynamic = "force-dynamic";

export default function FormsPage() {
  return (
    <>
      <h1>Forms</h1>
      <p className="sub">Field forms that write straight into the Deal Ledger.</p>
      <div className="form-cards">
        <a className="form-card" href="/forms/sale">
          <span className="form-card-kicker">Closer</span>
          <span className="form-card-title">Sales form</span>
          <span className="form-card-text">Log a new sale. Creates the deal, stamps today's commission and lender rates, and sets the products aside from that location's stock.</span>
        </a>
        <a className="form-card" href="/forms/install">
          <span className="form-card-kicker">Installer</span>
          <span className="form-card-title">Installer form</span>
          <span className="form-card-text">Pick the customer, confirm the install. Marks the job installed and takes the equipment out of the warehouse count.</span>
        </a>
      </div>
    </>
  );
}
