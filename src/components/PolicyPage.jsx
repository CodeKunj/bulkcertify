export default function PolicyPage({ onBack }) {
  return (
    <div className="app policy-app">
      <div className="live-bg" aria-hidden="true">
        <div className="aurora aurora-a" />
        <div className="aurora aurora-b" />
        <div className="grid-drift" />
      </div>

      <main className="policy-shell">
        <section className="policy-card">
          <div className="policy-head">
            <div className="badge">
              <span className="badge-dot" />
              Legal Information
            </div>
            <h1>Terms, Privacy and Policies</h1>
            <p className="sub policy-sub">
              This page combines Terms and Conditions, Privacy Policy, Returns and Refund Policy,
              Shipping Policy, and Contact details in one place.
            </p>
          </div>

          <section className="policy-section">
            <h2>Terms and Conditions</h2>
            <p>
              By using this service, you agree to use it for lawful purposes and provide accurate
              information where required. We may update features, pricing, and policies at any time.
              Continued use of the service after updates means you accept the revised terms.
            </p>
          </section>

          <section className="policy-section">
            <h2>Privacy Policy</h2>
            <p>
              We collect account and usage data needed to operate the certificate generation service,
              including billing and trial limits. Uploaded files are processed for generation purposes.
              We apply reasonable safeguards to protect data and only share data with trusted
              infrastructure and payment providers required to run the service.
            </p>
          </section>

          <section className="policy-section">
            <h2>Returns and Refund Policy</h2>
            <p>
              For subscription payments, refund requests are reviewed case by case. If you were charged
              incorrectly or experienced a billing issue, contact support with your account email and
              payment details. Approved refunds are processed to the original payment method.
            </p>
          </section>

          <section className="policy-section">
            <h2>Shipping Policy</h2>
            <p>
              This is a digital service. No physical product is shipped. Access is provided online
              immediately after account activation and successful payment confirmation.
            </p>
          </section>

          <section className="policy-section">
            <h2>Contact Us</h2>
            <p>
              For support, billing help, policy questions, or account issues, contact us at
              support@bulkcertify.com.
            </p>
          </section>

          <div className="policy-actions">
            <button type="button" className="account-btn" onClick={onBack}>
              Back to app
            </button>
          </div>
        </section>
      </main>

      <footer>
        All processing happens in your browser — no data is uploaded anywhere.
      </footer>
    </div>
  );
}
