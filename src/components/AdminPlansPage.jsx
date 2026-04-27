import { useMemo, useState } from "react";

const initialForm = {
  id: "",
  name: "",
  description: "",
  prices: {},
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

function PlanPricesDisplay({ plan }) {
  if (plan.prices && Object.keys(plan.prices).length > 0) {
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', maxWidth: '250px' }}>
        {Object.entries(plan.prices).map(([currency, amount]) => {
          const decimals = getCurrencyFractionDigits(currency);
          let formatted;
          try {
            formatted = new Intl.NumberFormat(undefined, {
              style: "currency",
              currency,
              minimumFractionDigits: decimals,
              maximumFractionDigits: decimals,
            }).format(amount);
          } catch {
            formatted = `${currency} ${Number(amount).toFixed(decimals)}`;
          }
          return (
            <span key={currency} style={{ fontSize: '0.75rem', padding: '0.15rem 0.4rem', backgroundColor: 'var(--border-base)', color: 'var(--text-color)', borderRadius: '4px', whiteSpace: 'nowrap' }}>
              {formatted}
            </span>
          );
        })}
      </div>
    );
  }

  // legacy fallback
  const currency = String(plan?.currency || "INR").toUpperCase();
  const amount = amountMajorFromPlan(plan);
  const decimals = getCurrencyFractionDigits(currency);

  let formatted;
  try {
    formatted = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(amount);
  } catch {
    formatted = `${currency} ${amount.toFixed(decimals)}`;
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', maxWidth: '250px' }}>
      <span style={{ fontSize: '0.75rem', padding: '0.15rem 0.4rem', backgroundColor: 'var(--border-base)', color: 'var(--text-color)', borderRadius: '4px', whiteSpace: 'nowrap' }}>
        {formatted}
      </span>
    </div>
  );
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
  const [isEditing, setIsEditing] = useState(false);

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

  const handleEditClick = (plan) => {
    setIsEditing(true);
    const mappedPrices = {};
    if (plan.prices) {
      for (const [key, val] of Object.entries(plan.prices)) {
        mappedPrices[key] = String(val);
      }
    } else {
      const c = String(plan.currency || "INR").toUpperCase();
      mappedPrices[c] = String(amountMajorFromPlan(plan));
    }

    setForm({
      id: plan.id,
      name: plan.name || "",
      description: plan.description || "",
      prices: mappedPrices,
      billingCycle: plan.billingCycle || "MONTHLY",
      isActive: !!plan.isActive,
      sortOrder: String(plan.sortOrder || "1"),
      features: Array.isArray(plan.features) ? plan.features.join(", ") : "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setForm(initialForm);
  };

  const submit = async (event) => {
    event.preventDefault();
    const parsedPrices = {};
    for (const [currency, val] of Object.entries(form.prices)) {
      const num = Number(val);
      if (Number.isFinite(num) && num > 0) {
        parsedPrices[currency] = num;
      }
    }

    if (Object.keys(parsedPrices).length === 0) {
      alert("Please enter a price for at least one currency.");
      return;
    }

    const payload = {
      name: form.name,
      description: form.description,
      prices: parsedPrices,
      billingCycle: form.billingCycle,
      isActive: !!form.isActive,
      sortOrder: Number(form.sortOrder),
      features: form.features,
    };

    if (isEditing) {
      await onEditPlan(form.id, payload);
    } else {
      await onCreatePlan(payload);
    }
    handleCancelEdit();
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
              <h2>{isEditing ? "Edit Plan" : "Create New Plan"}</h2>
              {isEditing && (
                <button type="button" className="ghost-link" onClick={handleCancelEdit}>
                  Cancel Edit
                </button>
              )}
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
                <label>Prices</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '1rem' }}>
                  {availableCurrencies.map((currency) => (
                    <div key={currency} style={{ display: 'flex', flexDirection: 'column' }}>
                      <label htmlFor={`price-${currency}`} style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{currency}</label>
                      <input
                        id={`price-${currency}`}
                        type="number"
                        step="0.01"
                        min="0"
                        value={form.prices[currency] || ""}
                        onChange={(e) => setForm((prev) => ({ ...prev, prices: { ...prev.prices, [currency]: e.target.value } }))}
                        placeholder={`Price in ${currency}`}
                      />
                    </div>
                  ))}
                </div>
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
                {loading ? "Saving..." : isEditing ? "Save Changes" : "Add Plan"}
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
                      <td><PlanPricesDisplay plan={plan} /></td>
                      <td>{formatBillingCycle(plan.billingCycle)}</td>
                      <td>{plan.isActive ? "Active" : "Inactive"}</td>
                      <td>{plan.sortOrder}</td>
                      <td>
                        <div className="admin-actions-row">
                          <button
                            type="button"
                            className="admin-action-btn"
                            disabled={busyId === plan.id}
                            onClick={() => handleEditClick(plan)}
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
