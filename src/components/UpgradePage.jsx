import { useState, useMemo } from "react";

export default function UpgradePage({
  isAuthenticated,
  account,
  billingBusy,
  accountLoading,
  accountUsesLeft,
  plans,
  supportedCurrencies = ["INR", "USD"],
  subscriptionAmountInr,
  startRazorpayCheckout,
  onBack,
  error,
  setAuthMode,
  setScreen,
  onOpenPolicy,
}) {
  const [selectedCurrency, setSelectedCurrency] = useState("INR");

  const availableCurrencies = useMemo(() => {
    if (!plans || !plans.length) return supportedCurrencies;
    const currencies = new Set();
    plans.forEach(p => {
      if (p.prices && typeof p.prices === 'object') {
        Object.keys(p.prices).forEach(c => currencies.add(String(c).toUpperCase()));
      }
    });
    const result = [...currencies];
    return result.length > 0 ? result : supportedCurrencies;
  }, [plans, supportedCurrencies]);

  const filteredPlans = useMemo(() => {
    return (plans || []).filter(p => p.prices && p.prices[selectedCurrency] !== undefined);
  }, [plans, selectedCurrency]);

  const getCurrencyFractionDigits = (currency) => (
    String(currency || "").toUpperCase() === "JPY" ? 0 : 2
  );

  const formatPlanPrice = (plan) => {
    const amountMajor = plan?.prices?.[selectedCurrency] || 0;
    const decimals = getCurrencyFractionDigits(selectedCurrency);

    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: selectedCurrency,
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }).format(amountMajor);
    } catch {
      return `${selectedCurrency} ${Number(amountMajor).toFixed(decimals)}`;
    }
  };

  return (
    <div className="app gate-app">
      <div className="live-bg" aria-hidden="true">
        <div className="aurora aurora-a" />
        <div className="aurora aurora-b" />
        <div className="grid-drift" />
      </div>

      <main className="gate-shell upgrade-shell">
        <section className="gate-copy">
          <div className="upgrade-heading-row">
            <div>
              <div className="badge">
                <span className="badge-dot" />
                Free Uses Finished
              </div>
              <h1>Upgrade to keep generating</h1>
            </div>
            <button type="button" className="ghost-link" onClick={onBack}>
              Back
            </button>
          </div>
          <p className="sub gate-sub">
            You have used your available free uses. Signed-in accounts get 2 free uses every month. Move to Pro for unlimited certificate generation and the full export set.
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

          <div className="gate-muted upgrade-plan-intro">
            Choose a plan below. Payment starts from the button inside each plan card.
          </div>

          <div className="field" style={{ maxWidth: '300px', margin: '0 auto 2rem auto', textAlign: 'left' }}>
            <label htmlFor="currency-select">Display Currency</label>
            <select
              id="currency-select"
              value={selectedCurrency}
              onChange={(e) => setSelectedCurrency(e.target.value)}
            >
              {availableCurrencies.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div className="upgrade-plan-grid">
            {filteredPlans.length === 0 ? (
              <div className="gate-muted" style={{ textAlign: "center", gridColumn: "1 / -1", padding: "2rem" }}>
                No plans available in {selectedCurrency}.
              </div>
            ) : (
              filteredPlans.map((plan) => (
                <article key={plan.id} className={`upgrade-plan-card ${plan.isActive ? "is-active" : "is-inactive"}`}>
                  <div className="upgrade-plan-head">
                    <div>
                      <h3>{plan.name}</h3>
                      <p>{plan.description || "Subscription plan"}</p>
                    </div>
                    <strong>{formatPlanPrice(plan)}</strong>
                  </div>
                  <div className="upgrade-plan-meta">
                    <span>{String(plan.billingCycle || "MONTHLY").toLowerCase()}</span>
                    <span>{plan.isActive ? "Active" : "Inactive"}</span>
                  </div>
                  <ul className="pricing-list upgrade-list">
                    {(Array.isArray(plan.features) ? plan.features : []).map((feature) => (
                      <li key={feature}>{feature}</li>
                    ))}
                  </ul>
                  <div className="upgrade-plan-actions">
                    {isAuthenticated ? (
                      <button
                        type="button"
                        className="account-btn"
                        onClick={() => startRazorpayCheckout(plan, selectedCurrency)}
                        disabled={billingBusy || accountLoading || !plan.isActive}
                      >
                        {plan.isActive ? `Pay ${formatPlanPrice(plan)} with Razorpay` : "Plan inactive"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="account-btn"
                        onClick={() => {
                          setAuthMode("signup");
                          setScreen("auth");
                        }}
                      >
                        Create account to pay
                      </button>
                    )}
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      </main>

      {error && <div className="upgrade-error-wrap"><div className="error-card">{error}</div></div>}

      <footer>
        All processing happens in your browser — no data is uploaded anywhere.
        <button type="button" className="footer-link" onClick={onOpenPolicy}>
          Privacy Policy
        </button>
      </footer>
    </div>
  );
}
