import { useMemo } from "react";

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

export default function AdminPage({
  loading,
  error,
  overview,
  clients,
  payments,
  activities,
  clientBusyId,
  onBack,
  onRefresh,
  onSearch,
  onUpdateTrial,
  onResetTrial,
  onToggleSubscription,
  onDeleteClient,
  onEditUsername,
  onEditPassword,
}) {
  const sortedClients = useMemo(() => {
    return [...clients].sort((a, b) => {
      const aDate = new Date(a.createdAt).getTime();
      const bDate = new Date(b.createdAt).getTime();
      return bDate - aDate;
    });
  }, [clients]);

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
              <h1>Website activity control center</h1>
              <p className="sub policy-sub">
                Monitor platform activity, manage clients, and review subscription payment records.
              </p>
            </div>
            <div className="admin-head-actions">
              <button type="button" className="account-btn" onClick={onRefresh} disabled={loading}>
                {loading ? "Refreshing..." : "Refresh Data"}
              </button>
              <button type="button" className="account-btn" onClick={onBack}>
                Back to Generator
              </button>
            </div>
          </div>

          {error && <div className="error-card">{error}</div>}

          <div className="admin-overview-grid">
            <article className="admin-stat">
              <span>Total Users</span>
              <strong>{overview.totalUsers || 0}</strong>
            </article>
            <article className="admin-stat">
              <span>Active Subscribers</span>
              <strong>{overview.activeSubscribers || 0}</strong>
            </article>
            <article className="admin-stat">
              <span>Total Payments</span>
              <strong>{overview.totalPayments || 0}</strong>
            </article>
            <article className="admin-stat">
              <span>Total Generations</span>
              <strong>{overview.totalGenerations || 0}</strong>
            </article>
          </div>

          <section className="admin-section admin-section-clients">
            <div className="admin-section-head">
              <h2>Client Management</h2>
              <input
                type="text"
                className="admin-search"
                placeholder="Search client by email"
                onChange={(event) => onSearch(event.target.value)}
              />
            </div>
            <div className="profile-table-wrap admin-scroll-wrap">
              <table className="profile-table admin-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Trial Uses Left</th>
                    <th>Subscription</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedClients.map((client) => (
                    <tr key={client.id}>
                      <td>{client.email}</td>
                      <td>{client.isAdmin ? "Admin" : "Client"}</td>
                      <td>{Math.max(client.trialUsageCount || 0, 0)}</td>
                      <td>{client.isSubscribed ? "Active" : "Inactive"}</td>
                      <td>{formatDate(client.createdAt)}</td>
                      <td>
                        <div className="admin-actions-row">
                          <button
                            type="button"
                            className="admin-action-btn"
                            disabled={clientBusyId === client.id}
                            onClick={() => onUpdateTrial(client, 1)}
                          >
                            +1 Trial
                          </button>
                          <button
                            type="button"
                            className="admin-action-btn"
                            disabled={clientBusyId === client.id}
                            onClick={() => onResetTrial(client.id)}
                          >
                            Reset Trial
                          </button>
                          <button
                            type="button"
                            className="admin-action-btn"
                            disabled={clientBusyId === client.id}
                            onClick={() => onToggleSubscription(client)}
                          >
                            {client.isSubscribed ? "Deactivate Plan" : "Activate Plan"}
                          </button>
                          <button
                            type="button"
                            className="admin-action-btn"
                            disabled={clientBusyId === client.id}
                            onClick={() => onEditUsername(client)}
                          >
                            Edit Username
                          </button>
                          <button
                            type="button"
                            className="admin-action-btn"
                            disabled={clientBusyId === client.id}
                            onClick={() => onEditPassword(client)}
                          >
                            Edit Password
                          </button>
                          {!client.isAdmin && (
                            <button
                              type="button"
                              className="admin-action-btn danger"
                              disabled={clientBusyId === client.id}
                              onClick={() => onDeleteClient(client)}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!sortedClients.length && (
                    <tr>
                      <td colSpan={6}>No clients found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <div className="admin-lower-grid">
            <section className="admin-section">
              <div className="admin-section-head">
                <h2>Recent Payments</h2>
              </div>
              <div className="profile-table-wrap admin-scroll-wrap">
                <table className="profile-table admin-table">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Plan</th>
                      <th>Status</th>
                      <th>Subscription Id</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((payment) => (
                      <tr key={payment.id}>
                        <td>{payment.userEmail || "-"}</td>
                        <td>{payment.planName} ({payment.billingCycle})</td>
                        <td>{payment.status}</td>
                        <td>{payment.subscriptionId}</td>
                        <td>{formatDate(payment.createdAt)}</td>
                      </tr>
                    ))}
                    {!payments.length && (
                      <tr>
                        <td colSpan={5}>No payment records found.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="admin-section">
              <div className="admin-section-head">
                <h2>Recent Activities</h2>
              </div>
              <div className="profile-table-wrap admin-scroll-wrap">
                <table className="profile-table admin-table admin-table-activities">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Action</th>
                      <th>Actor</th>
                      <th className="activities-target-col">Target</th>
                      <th>IP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activities.map((activity) => (
                      <tr key={activity.id}>
                        <td>{formatDate(activity.createdAt)}</td>
                        <td>{activity.action}</td>
                        <td>{activity.actorEmail || "-"}</td>
                        <td className="activities-target-col">{activity.targetType || "-"} {activity.targetId || ""}</td>
                        <td>{activity.ipAddress || "-"}</td>
                      </tr>
                    ))}
                    {!activities.length && (
                      <tr>
                        <td colSpan={5}>No activity found yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </section>
      </main>
    </div>
  );
}
