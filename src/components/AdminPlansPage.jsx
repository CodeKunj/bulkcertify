import { useMemo, useState } from "react";

const initialForm = {
  name: "",
  description: "",
  currency: "INR",
  amount: "9",
  billingCycle: "MONTHLY",
  isActive: true,
  sortOrder: "1",
  features: "Unlimited generation runs, DOCX, PDF, and JPG export",
};

const fallbackCurrencies = ["INR", "USD", "EUR", "GBP", "AUD", "CAD", "SGD", "AED"];

function getCurrencyFractionDigits(currency) {
  return String(currency || "").toUpperCase() === "JPY" ? 0 : 2;
}

function amountMajorFromPlan(plan) {
  const currency = String(plan?.currency || "INR").toUpperCase();
  const decimals = getCurrencyFractionDigits(currency);
  const amountMinor = Number(plan?.amountMinor);

  if (Number.isFinite(amountMinor) && amountMinor > 0) {
    return amountMinor / 10 ** decimals;
  }

  if (currency === "INR") {
    return Math.max(Number(plan?.priceInr || 0), 0);
  }

  return 0;
}

function formatPlanPrice(plan) {
  const currency = String(plan?.currency || "INR").toUpperCase();
  const amount = amountMajorFromPlan(plan);
  const decimals = getCurrencyFractionDigits(currency);

  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(decimals)}`;
  }
}

function formatBillingCycle(value) {
  const cycle = String(value || "MONTHLY").toUpperCase();
  if (cycle === "YEARLY") return "Yearly";
  if (cycle === "QUARTERLY") return "Quarterly";
  return "Monthly";
}

export default function AdminPlansPage({
  loading,
  busyId,
  error,
  plans,
  currencyOptions,
  onBack,
  onRefresh,
  onCreatePlan,
  onEditPlan,
  onDeletePlan,
}) {
  const [form, setForm] = useState(initialForm);

  const availableCurrencies = useMemo(() => {
    const source = Array.isArray(currencyOptions) && currencyOptions.length
      ? currencyOptions
      : fallbackCurrencies;

    return [...new Set(
      source
        .map((currency) => String(currency || "").trim().toUpperCase())
        .filter(Boolean)
    )];
  }, [currencyOptions]);

  const sortedPlans = useMemo(() => {
    return [...plans].sort((a, b) => {
      const aOrder = Number(a?.sortOrder || 0);
      const bOrder = Number(b?.sortOrder || 0);
      if (aOrder !== bOrder) return aOrder - bOrder;
      return String(a?.name || "").localeCompare(String(b?.name || ""));
    });
  }, [plans]);

  const submit = async (event) => {
    event.preventDefault();
    const currency = String(form.currency || "INR").trim().toUpperCase();
    const amount = Number(form.amount);

    await onCreatePlan({
      name: form.name,
      description: form.description,
      currency,
      amount,
      priceInr: currency === "INR" ? Math.floor(amount) : undefined,
      billingCycle: form.billingCycle,
      isActive: !!form.isActive,
      sortOrder: Number(form.sortOrder),
      features: form.features,
    });
    setForm(initialForm);
  };

  return (
    <div className="app admin-page-desktop">
      <div className="live-bg" aria-hidden="true">
        <div className="aurora aurora-a" />
        <div className="aurora aurora-b" />
        <div className="grid-drift" />
      </div>

      <main className="policy-shell admin-shell admin-desktop-lock">
        <section className="policy-card profile-card admin-card">
          <div className="policy-head admin-head">
            <div>
              <div className="badge">
                <span className="badge-dot" />
                Admin Panel
              </div>
              <h1>Upgrade Plan Management</h1>
              <p className="sub policy-sub">
                Add, edit, activate/deactivate, and remove subscription plans.
              </p>
            </div>
            <div className="admin-head-actions">
              <button type="button" className="account-btn" onClick={onRefresh} disabled={loading}>
                {loading ? "Refreshing..." : "Refresh Plans"}
              </button>
              <button type="button" className="account-btn" onClick={onBack}>
                Back to Admin Panel
              </button>
            </div>
          </div>

          {error && <div className="error-card">{error}</div>}

          <section className="admin-section">
            <div className="admin-section-head">
              <h2>Create New Plan</h2>
            </div>

            <form className="admin-plan-form" onSubmit={submit}>
              <div className="field">
                <label htmlFor="plan-name">Plan name</label>
                <input
                  id="plan-name"
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="Pro Plan"
                  required
                />
              </div>

              <div className="field">
                <label htmlFor="plan-description">Description</label>
                <input
                  id="plan-description"
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                  placeholder="Unlimited certificate generations"
                />
              </div>

              <div className="field">
                <label htmlFor="plan-currency">Currency</label>
                <select
                  id="plan-currency"
                  value={form.currency}
                  onChange={(e) => setForm((prev) => ({ ...prev, currency: e.target.value }))}
                >
                  {availableCurrencies.map((currency) => (
                    <option key={currency} value={currency}>{currency}</option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor="plan-price">Price</label>
                <input
                  id="plan-price"
                  type="number"
                  step="0.01"
                  min="1"
                  value={form.amount}
                  onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))}
                  required
                />
              </div>

              <div className="field">
                <label htmlFor="plan-billing">Billing cycle</label>
                <select
                  id="plan-billing"
                  value={form.billingCycle}
                  onChange={(e) => setForm((prev) => ({ ...prev, billingCycle: e.target.value }))}
                >
                  <option value="MONTHLY">Monthly</option>
                  <option value="QUARTERLY">Quarterly</option>
                  <option value="YEARLY">Yearly</option>
                </select>
              </div>

              <div className="field">
                <label htmlFor="plan-order">Sort order</label>
                <input
                  id="plan-order"
                  type="number"
                  min="0"
                  value={form.sortOrder}
                  onChange={(e) => setForm((prev) => ({ ...prev, sortOrder: e.target.value }))}
                />
              </div>

              <div className="field">
                <label htmlFor="plan-features">Features (comma-separated)</label>
                <input
                  id="plan-features"
                  type="text"
                  value={form.features}
                  onChange={(e) => setForm((prev) => ({ ...prev, features: e.target.value }))}
                  placeholder="Feature A, Feature B"
                />
              </div>

              <label className="admin-plan-checkbox">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm((prev) => ({ ...prev, isActive: e.target.checked }))}
                />
                Active plan
              </label>

              <button type="submit" className="account-btn" disabled={loading}>
                {loading ? "Saving..." : "Add Plan"}
              </button>
            </form>
          </section>

          <section className="admin-section">
            <div className="admin-section-head">
              <h2>Existing Plans</h2>
            </div>
            <div className="profile-table-wrap admin-scroll-wrap">
              <table className="profile-table admin-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Price</th>
                    <th>Cycle</th>
                    <th>Status</th>
                    <th>Order</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedPlans.map((plan) => (
                    <tr key={plan.id}>
                      <td>
                        <strong>{plan.name}</strong>
                        <div className="admin-plan-subtext">{plan.description || "-"}</div>
                      </td>
                      <td>{formatPlanPrice(plan)}</td>
                      <td>{formatBillingCycle(plan.billingCycle)}</td>
                      <td>{plan.isActive ? "Active" : "Inactive"}</td>
                      <td>{plan.sortOrder}</td>
                      <td>
                        <div className="admin-actions-row">
                          <button
                            type="button"
                            className="admin-action-btn"
                            disabled={busyId === plan.id}
                            onClick={() => onEditPlan(plan)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="admin-action-btn danger"
                            disabled={busyId === plan.id}
                            onClick={() => onDeletePlan(plan)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!sortedPlans.length && (
                    <tr>
                      <td colSpan={6}>No plans configured.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      </main>
    </div>
  );
}
