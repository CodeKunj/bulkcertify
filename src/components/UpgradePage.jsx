export default function UpgradePage({
  isAuthenticated,
  account,
  billingBusy,
  accountLoading,
  accountUsesLeft,
  startRazorpayCheckout,
  onBack,
  error,
  setAuthMode,
  setScreen,
  onOpenPolicy,
}) {
  return (
    <div className="app gate-app">
      <div className="live-bg" aria-hidden="true">
        <div className="aurora aurora-a" />
        <div className="aurora aurora-b" />
        <div className="grid-drift" />
      </div>

      <main className="gate-shell upgrade-shell">
        <section className="gate-copy">
          <div className="badge">
            <span className="badge-dot" />
            Free Uses Finished
          </div>
          <h1>Upgrade to keep generating</h1>
          <p className="sub gate-sub">
            You have used all 3 free runs. Move to Pro for unlimited certificate generation and the full export set.
          </p>

          <div className="gate-points">
            <div className="gate-point">
              <strong>Unlimited runs</strong>
              <span>Keep generating without hitting the free-use wall.</span>
            </div>
            <div className="gate-point">
              <strong>DOCX, PDF, JPG</strong>
              <span>Pick the export format that fits your workflow.</span>
            </div>
            <div className="gate-point">
              <strong>One workspace</strong>
              <span>Your account stays connected to the same generator flow.</span>
            </div>
          </div>
        </section>

        <section className="gate-card upgrade-card">
          <button type="button" className="ghost-link" onClick={onBack}>
            Back
          </button>

          <div className="pricing-head">
            <h3>Pro Plan</h3>
            <p>Unlimited certificate generations with all export formats.</p>
          </div>
          <div className="pricing-price upgrade-price">
            <strong>$9</strong>
            <span>/month</span>
          </div>
          <ul className="pricing-list upgrade-list">
            <li>Unlimited generation runs</li>
            <li>DOCX, PDF, and JPG export</li>
            <li>Priority support</li>
          </ul>

          {isAuthenticated ? (
            <div className="upgrade-actions">
              <button
                type="button"
                className="account-btn"
                onClick={startRazorpayCheckout}
                disabled={billingBusy || accountLoading}
              >
                {account?.isSubscribed ? "Subscription Active" : "Upgrade with Razorpay"}
              </button>
              <span className="gate-muted">
                {accountLoading
                  ? "Loading account..."
                  : account?.isSubscribed
                    ? "Your Razorpay plan is already active."
                    : `${accountUsesLeft} trial use${accountUsesLeft === 1 ? "" : "s"} left in your account.`}
              </span>
            </div>
          ) : (
            <div className="upgrade-actions">
              <button
                type="button"
                className="account-btn"
                onClick={() => {
                  setAuthMode("signup");
                  setScreen("auth");
                }}
              >
                Create account
              </button>
              <button
                type="button"
                className="ghost-link"
                onClick={() => {
                  setAuthMode("login");
                  setScreen("auth");
                }}
              >
                I already have an account
              </button>
            </div>
          )}

          {error && <div className="error-card">{error}</div>}

          <div className="upgrade-note upgrade-note-strong">
            You can return to the generator any time after signing in or upgrading.
          </div>
        </section>
      </main>

      <footer>
        All processing happens in your browser — no data is uploaded anywhere.
        <button type="button" className="footer-link" onClick={onOpenPolicy}>
          Privacy Policy
        </button>
      </footer>
    </div>
  );
}
