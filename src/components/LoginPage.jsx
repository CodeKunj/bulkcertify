export default function LoginPage({
  authMode,
  setAuthMode,
  authEmail,
  setAuthEmail,
  authPassword,
  setAuthPassword,
  authBusy,
  authError,
  signIn,
  continueAsGuest,
  guestLoading,
  guestUsesLeft,
  onOpenPolicy,
}) {
  return (
    <div className="app gate-app">
      <div className="live-bg" aria-hidden="true">
        <div className="aurora aurora-a" />
        <div className="aurora aurora-b" />
        <div className="grid-drift" />
      </div>

      <main className="gate-shell">
        <section className="gate-copy">
          <div className="badge">
            <span className="badge-dot" />
            Certificate Workspace
          </div>
          <h1>{authMode === "login" ? "Welcome back" : "Create your account"}</h1>
          <p className="sub gate-sub">
            {authMode === "login"
              ? "Return to your certificate workspace with your username and password."
              : "Create an account with username and password to start generating certificates."}
          </p>

          <div className="gate-points">
            <div className="gate-point">
              <strong>2 free uses every month</strong>
              <span>Signed-in accounts get 2 free generations each month before upgrade.</span>
            </div>
            <div className="gate-point">
              <strong>DOCX, PDF, JPG</strong>
              <span>Export the finished certificates in the format you need.</span>
            </div>
            <div className="gate-point">
              <strong>Secure local auth</strong>
              <span>Sign up creates your account, and login verifies your password.</span>
            </div>
          </div>
        </section>

        <section className="gate-card">
          <div className="gate-tabs" role="tablist" aria-label="Authentication mode">
            <button
              type="button"
              className={`gate-tab ${authMode === "login" ? "active" : ""}`}
              onClick={() => setAuthMode("login")}
            >
              Login
            </button>
            <button
              type="button"
              className={`gate-tab ${authMode === "signup" ? "active" : ""}`}
              onClick={() => setAuthMode("signup")}
            >
              Sign Up
            </button>
          </div>

          <form className="auth-form gate-form" onSubmit={signIn}>
            <div className="field">
              <label htmlFor="auth-email">Username</label>
              <input
                id="auth-email"
                type="text"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                placeholder="Enter your username"
              />
            </div>
            <div className="field">
              <label htmlFor="auth-password">Password</label>
              <input
                id="auth-password"
                type="password"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                placeholder="Enter your password"
              />
            </div>
            <button type="submit" className="account-btn gate-submit" disabled={authBusy}>
              {authBusy
                ? authMode === "login"
                  ? "Logging in..."
                  : "Creating account..."
                : authMode === "login"
                  ? "Log in"
                  : "Create account"}
            </button>
          </form>

          {authError && <div className="error-card">{authError}</div>}

          <div className="gate-actions">
            <button type="button" className="ghost-link" onClick={continueAsGuest}>
              Continue as guest
            </button>
            <span className="gate-muted">
              {guestLoading
                ? "Checking guest usage..."
                : `${guestUsesLeft} free guest use${guestUsesLeft === 1 ? "" : "s"} left.`}
            </span>
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
