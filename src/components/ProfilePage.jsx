function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

export default function ProfilePage({ profile, loading, onBack }) {
  const currentPlan = profile?.currentPlan;
  const previousPlans = profile?.previousPlans || [];

  return (
    <div className="app policy-app">
      <div className="live-bg" aria-hidden="true">
        <div className="aurora aurora-a" />
        <div className="aurora aurora-b" />
        <div className="grid-drift" />
      </div>

      <main className="policy-shell">
        <section className="policy-card profile-card">
          <div className="policy-head">
            <div className="badge">
              <span className="badge-dot" />
              User Profile
            </div>
            <h1>Account and Plan Details</h1>
            <p className="sub policy-sub">
              View your account details, current monthly plan, previous plans, and remaining days.
            </p>
          </div>

          {loading ? (
            <div className="profile-empty">Loading profile...</div>
          ) : (
            <>
              <section className="profile-grid">
                <article className="profile-item">
                  <h3>User ID</h3>
                  <p>{profile?.id || "-"}</p>
                </article>
                <article className="profile-item">
                  <h3>Email</h3>
                  <p>{profile?.email || "-"}</p>
                </article>
                <article className="profile-item">
                  <h3>Status</h3>
                  <p>{profile?.isSubscribed ? "Subscribed" : "Not Subscribed"}</p>
                </article>
                <article className="profile-item">
                  <h3>Trial Uses Left</h3>
                  <p>{Math.max(profile?.trialUsageCount || 0, 0)}</p>
                </article>
              </section>

              <section className="policy-section">
                <h2>Current Plan</h2>
                {currentPlan ? (
                  <div className="profile-grid">
                    <article className="profile-item">
                      <h3>Plan</h3>
                      <p>{currentPlan.planName}</p>
                    </article>
                    <article className="profile-item">
                      <h3>Billing Cycle</h3>
                      <p>{currentPlan.billingCycle}</p>
                    </article>
                    <article className="profile-item">
                      <h3>Start Date</h3>
                      <p>{formatDate(currentPlan.startDate)}</p>
                    </article>
                    <article className="profile-item">
                      <h3>End Date</h3>
                      <p>{formatDate(currentPlan.endDate)}</p>
                    </article>
                    <article className="profile-item">
                      <h3>Days Remaining</h3>
                      <p>{currentPlan.daysRemaining}</p>
                    </article>
                    <article className="profile-item">
                      <h3>Subscription ID</h3>
                      <p>{currentPlan.subscriptionId}</p>
                    </article>
                  </div>
                ) : (
                  <div className="profile-empty">No active plan right now.</div>
                )}
              </section>

              <section className="policy-section">
                <h2>Previous Plans</h2>
                {previousPlans.length === 0 ? (
                  <div className="profile-empty">No previous plans found.</div>
                ) : (
                  <div className="profile-table-wrap">
                    <table className="profile-table">
                      <thead>
                        <tr>
                          <th>Plan</th>
                          <th>Cycle</th>
                          <th>Status</th>
                          <th>Start Date</th>
                          <th>End Date</th>
                          <th>Days Remaining</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previousPlans.map((plan) => (
                          <tr key={plan.id}>
                            <td>{plan.planName}</td>
                            <td>{plan.billingCycle}</td>
                            <td>{plan.status}</td>
                            <td>{formatDate(plan.startDate)}</td>
                            <td>{formatDate(plan.endDate)}</td>
                            <td>{plan.daysRemaining}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}

          <div className="policy-actions">
            <button type="button" className="account-btn" onClick={onBack}>
              Back to generator
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
