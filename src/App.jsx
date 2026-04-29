import { useState, useCallback, useEffect } from "react";
import { GoogleOAuthProvider } from "@react-oauth/google";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { renderAsync } from "docx-preview";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import DropZone from "./components/DropZone";
import ProgressCard from "./components/ProgressCard";
import LoginPage from "./components/LoginPage";
import UpgradePage from "./components/UpgradePage";
import PolicyPage from "./components/PolicyPage";
import ProfilePage from "./components/ProfilePage";
import AdminPage from "./components/AdminPage";
import AdminPlansPage from "./components/AdminPlansPage";
import "./App.css";
import sampleDocxUrl from "../Sample_certificate.docx";

const THEME_COOKIE_NAME = "bulkcertify_theme_mode";

function getCookieValue(name) {
  if (typeof document === "undefined") return "";

  const parts = document.cookie ? document.cookie.split("; ") : [];
  const match = parts.find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : "";
}

function setSessionCookie(name, value) {
  if (typeof document === "undefined") return;

  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; SameSite=Lax`;
}

function setPersistentCookie(name, value, daysToExpire = 365) {
  if (typeof document === "undefined") return;

  const maxAgeSeconds = daysToExpire * 24 * 60 * 60;
  const date = new Date();
  date.setTime(date.getTime() + daysToExpire * 24 * 60 * 60 * 1000);
  const expires = date.toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${maxAgeSeconds}; expires=${expires}; path=/; SameSite=Lax`;
}

function getInitialTheme() {
  if (typeof document === "undefined") return "light";
  
  const savedTheme = getCookieValue(THEME_COOKIE_NAME);
  if (savedTheme === "light" || savedTheme === "dark") {
    return savedTheme;
  }

  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "dark" : "light";
}

function replaceInXml(xml, placeholder, value) {
  const safe = value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const esc = placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let replaced = false;
  xml = xml.replace(new RegExp(esc, "g"), () => {
    replaced = true;
    return safe;
  });
  const frag = placeholder
    .split("")
    .map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?:<[^>]+>)*")
    .join("");
  xml = xml.replace(new RegExp(frag, "g"), () => {
    replaced = true;
    return safe;
  });
  return { xml, replaced };
}

function normalizeFieldValue(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

async function renderDocxBlobToCanvas(docxBlob) {
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-99999px";
  host.style.top = "0";
  host.style.width = "1400px";
  host.style.background = "#ffffff";
  host.style.padding = "20px";
  host.style.zIndex = "-1";
  document.body.appendChild(host);

  try {
    const buffer = await docxBlob.arrayBuffer();
    await renderAsync(buffer, host, undefined, {
      inWrapper: true,
      breakPages: false,
      ignoreLastRenderedPageBreak: true,
      useBase64URL: true,
    });

    const captureTarget = host.querySelector(".docx-wrapper") || host;
    return await html2canvas(captureTarget, {
      backgroundColor: "#ffffff",
      scale: 2,
      useCORS: true,
      logging: false,
    });
  } finally {
    document.body.removeChild(host);
  }
}

async function convertDocxBlobToJpgBlob(docxBlob) {
  const canvas = await renderDocxBlobToCanvas(docxBlob);
  return await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Could not create JPG output."));
        return;
      }
      resolve(blob);
    }, "image/jpeg", 0.95);
  });
}

async function convertDocxBlobToPdfBlob(docxBlob) {
  const canvas = await renderDocxBlobToCanvas(docxBlob);
  const width = canvas.width;
  const height = canvas.height;
  const orientation = width > height ? "landscape" : "portrait";

  const pdf = new jsPDF({
    orientation,
    unit: "px",
    format: [width, height],
    compress: true,
  });

  pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, width, height, undefined, "FAST");
  return pdf.output("blob");
}

function triggerDownload(blobOrUrl, fileName) {
  const a = document.createElement("a");
  if (typeof blobOrUrl === "string") {
    a.href = blobOrUrl;
  } else {
    a.href = URL.createObjectURL(blobOrUrl);
  }
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  if (typeof blobOrUrl !== "string") {
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
}

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

function loadRazorpayCheckout() {
  if (window.Razorpay) {
    return Promise.resolve(true);
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => reject(new Error("Could not load Razorpay checkout."));
    document.body.appendChild(script);
  });
}

export default function App() {
  const apiBase = import.meta.env.VITE_API_URL || "";
  const [themeMode, setThemeMode] = useState(getInitialTheme());
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [screen, setScreen] = useState("generator");
  const [upgradeReturnScreen, setUpgradeReturnScreen] = useState("generator");
  const [skipUpgradeRedirectOnce, setSkipUpgradeRedirectOnce] = useState(false);
  const [policyReturnScreen, setPolicyReturnScreen] = useState("generator");
  const [authMode, setAuthMode] = useState("login");
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleClientId, setGoogleClientId] = useState("");

  const [docxFile, setDocxFile] = useState(null);
  const [rows, setRows] = useState([]);
  const [columns, setColumns] = useState([]);
  const [selectedCol, setSelectedCol] = useState("");
  const [placeholder, setPlaceholder] = useState("{{NAME}}");
  const [extraAttrs, setExtraAttrs] = useState([]);
  const [downloadFormat, setDownloadFormat] = useState("docx");
  const [progress, setProgress] = useState(null);
  const [account, setAccount] = useState(null);
  const [accountLoading, setAccountLoading] = useState(false);
  const [guestTrial, setGuestTrial] = useState(null);
  const [guestLoading, setGuestLoading] = useState(false);
  const [billingBusy, setBillingBusy] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileData, setProfileData] = useState(null);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState("");
  const [adminOverview, setAdminOverview] = useState({});
  const [adminClients, setAdminClients] = useState([]);
  const [adminPayments, setAdminPayments] = useState([]);
  const [adminActivities, setAdminActivities] = useState([]);
  const [adminPlans, setAdminPlans] = useState([]);
  const [adminPlansLoading, setAdminPlansLoading] = useState(false);
  const [adminPlansError, setAdminPlansError] = useState("");
  const [adminPlanBusyId, setAdminPlanBusyId] = useState(null);
  const [adminClientBusyId, setAdminClientBusyId] = useState(null);
  const [adminSearch, setAdminSearch] = useState("");
  const [publicPlans, setPublicPlans] = useState([]);
  const [supportedCurrencies, setSupportedCurrencies] = useState(["INR", "USD", "EUR", "GBP", "AUD", "CAD", "SGD", "AED"]);
  const [subscriptionAmountInr, setSubscriptionAmountInr] = useState(9);
  const [adminSubscriptionBusy, setAdminSubscriptionBusy] = useState(false);
  const [error, setError] = useState("");

  const getApiUrl = useCallback(
    (path) => (apiBase ? `${apiBase}${path}` : path),
    [apiBase]
  );

  useEffect(() => {
    // Apply theme to document on mount and whenever it changes
    document.documentElement.setAttribute("data-theme", themeMode);
    // Save theme to persistent cookie
    setPersistentCookie(THEME_COOKIE_NAME, themeMode, 365);
  }, [themeMode]);

  useEffect(() => {
    const savedAuth = window.localStorage.getItem("bulkcertify_local_auth");
    if (savedAuth) {
      try {
        const parsed = JSON.parse(savedAuth);
        if (parsed?.email) {
          setAuthEmail(parsed.email);
          setIsAuthenticated(true);
          setScreen("generator");
        }
      } catch {
        window.localStorage.removeItem("bulkcertify_local_auth");
      }
    }
    setAuthLoading(false);
  }, []);

  useEffect(() => {
    if (authLoading) return;

    if (skipUpgradeRedirectOnce && screen !== "upgrade") {
      setSkipUpgradeRedirectOnce(false);
      return;
    }

    const isFlowScreen =
      screen === "generator" ||
      screen === "auth" ||
      screen === "upgrade";

    if (!isFlowScreen) {
      return;
    }

    if (isAuthenticated) {
      if (account?.isAdmin || account?.isSubscribed) {
        setScreen("generator");
      } else if (!accountLoading && account && !account.canGenerate && screen !== "upgrade") {
        setUpgradeReturnScreen(screen);
        setScreen("upgrade");
      }
      return;
    }

    if (screen === "upgrade") {
      return;
    }

    if (guestTrial && !guestTrial.canGenerate && screen === "generator") {
      setUpgradeReturnScreen(screen);
      setScreen("upgrade");
    }
  }, [
    account,
    accountLoading,
    authLoading,
    guestTrial,
    isAuthenticated,
    screen,
    skipUpgradeRedirectOnce,
  ]);

  useEffect(() => {
    const loadGoogleClientId = async () => {
      try {
        const res = await fetch(getApiUrl("/api/auth/google/init"));
        const body = await res.json();
        if (res.ok && body.clientId) {
          setGoogleClientId(body.clientId);
        }
      } catch (err) {
        // Google OAuth not configured or error loading
        console.debug("Google OAuth not available:", err.message);
      }
    };
    loadGoogleClientId();
  }, []);

  const authHeaders = useCallback(() => {
    if (!isAuthenticated || !authEmail) return {};
    return { "x-user-email": authEmail };
  }, [authEmail, isAuthenticated]);

  const authedFetch = useCallback(
    async (path, options = {}) => {
      const headers = {
        "Content-Type": "application/json",
        ...authHeaders(),
        ...(options.headers || {}),
      };

      if (!headers["x-user-email"]) {
        throw new Error("Please sign in to continue.");
      }

      return fetch(getApiUrl(path), {
        ...options,
        headers,
      });
    },
    [authHeaders, getApiUrl]
  );

  const publicFetch = useCallback(
    async (path, options = {}) => {
      return fetch(getApiUrl(path), {
        ...options,
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(options.headers || {}),
        },
      });
    },
    [getApiUrl]
  );

  const loadAccount = useCallback(async () => {
    if (!isAuthenticated) {
      setAccount(null);
      return;
    }

    setAccountLoading(true);
    try {
      const res = await authedFetch("/api/me");
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || "Could not load your account.");
      }
      setAccount(body);
    } catch (err) {
      setError(err.message || "Could not load your account.");
    } finally {
      setAccountLoading(false);
    }
  }, [authedFetch, isAuthenticated]);

  useEffect(() => {
    if (authLoading) return;
    loadAccount();
  }, [authLoading, loadAccount]);

  const loadGuestTrial = useCallback(async () => {
    if (isAuthenticated) {
      setGuestTrial(null);
      return;
    }

    setGuestLoading(true);
    try {
      const res = await publicFetch("/api/guest/status");
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || "Could not load guest trial status.");
      }
      setGuestTrial(body);
    } catch (err) {
      setError(err.message || "Could not load guest trial status.");
    } finally {
      setGuestLoading(false);
    }
  }, [isAuthenticated, publicFetch]);

  useEffect(() => {
    if (authLoading) return;
    loadGuestTrial();
  }, [authLoading, loadGuestTrial]);

  const loadSubscriptionSettings = useCallback(async () => {
    try {
      const res = await publicFetch("/api/subscription-settings");
      const body = await res.json();
      if (!res.ok) return;

      const parsedAmount = Number(body?.amountInr);
      if (Number.isFinite(parsedAmount) && parsedAmount > 0) {
        setSubscriptionAmountInr(Math.floor(parsedAmount));
      }
      if (Array.isArray(body?.supportedCurrencies) && body.supportedCurrencies.length) {
        setSupportedCurrencies([
          ...new Set(
            body.supportedCurrencies
              .map((currency) => String(currency || "").trim().toUpperCase())
              .filter(Boolean)
          ),
        ]);
      }
    } catch {
      // Keep default amount when loading settings fails.
    }
  }, [publicFetch]);

  const loadPublicPlans = useCallback(async () => {
    try {
      const res = await publicFetch("/api/plans");
      const body = await res.json();
      if (!res.ok) return;

      setPublicPlans(Array.isArray(body?.plans) ? body.plans : []);
    } catch {
      // Keep the upgrade screen usable even if plan loading fails.
    }
  }, [publicFetch]);

  useEffect(() => {
    loadSubscriptionSettings();
    loadPublicPlans();
  }, [loadPublicPlans, loadSubscriptionSettings]);

  const signIn = async (event) => {
    event.preventDefault();
    setAuthError("");

    const email = authEmail.trim().toLowerCase();
    const password = authPassword.trim();

    if (!email) {
      setAuthError("Enter a username to continue.");
      return;
    }

    if (!password) {
      setAuthError("Enter a password to continue.");
      return;
    }

    setAuthBusy(true);
    try {
      const endpoint = authMode === "signup" ? "/api/auth/signup" : "/api/auth/login";
      const res = await publicFetch(endpoint, {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json();

      if (!res.ok) {
        throw new Error(body.error || "Authentication failed.");
      }

      window.localStorage.setItem("bulkcertify_local_auth", JSON.stringify({ email }));
      setAuthEmail(email);
      setIsAuthenticated(true);
      setScreen("generator");
      setAccount(body.account || null);
      setError("");
    } catch (err) {
      setAuthError(err.message || "Authentication failed.");
    } finally {
      setAuthBusy(false);
    }
  };

  const handleGoogleSignIn = async (credentialResponse) => {
    setAuthError("");
    setGoogleBusy(true);
    try {
      const res = await publicFetch("/api/auth/google/verify", {
        method: "POST",
        body: JSON.stringify({ token: credentialResponse.credential }),
      });
      const body = await res.json();

      if (!res.ok) {
        throw new Error(body.error || "Google authentication failed.");
      }

      // Store the email from Google OAuth for future requests
      const email = body.account?.email;
      if (email) {
        window.localStorage.setItem("bulkcertify_local_auth", JSON.stringify({ email }));
        setAuthEmail(email);
      }

      setIsAuthenticated(true);
      setScreen("generator");
      setAccount(body.account || null);
      setError("");
    } catch (err) {
      setAuthError(err.message || "Google authentication failed.");
    } finally {
      setGoogleBusy(false);
    }
  };

  const continueAsGuest = () => {
    setAuthError("");
    setError("");
    setScreen("generator");
  };

  const openPolicyPage = (fromScreen = "generator") => {
    setPolicyReturnScreen(fromScreen);
    setScreen("policy");
  };

  const closePolicyPage = () => {
    setScreen(policyReturnScreen || "generator");
  };

  const closeUpgradePage = () => {
    const allowedUpgradeReturnScreens = new Set(["generator", "auth"]);
    const safeReturnScreen = allowedUpgradeReturnScreens.has(upgradeReturnScreen)
      ? upgradeReturnScreen
      : "generator";
    setSkipUpgradeRedirectOnce(true);
    setScreen(safeReturnScreen);
  };

  const openProfilePage = async () => {
    if (!isAuthenticated) {
      setError("Please sign in to view profile.");
      setScreen("auth");
      return;
    }

    setError("");
    setProfileBusy(true);
    try {
      const res = await authedFetch("/api/profile");
      const body = await res.json();

      if (!res.ok) {
        throw new Error(body.error || "Could not load your profile.");
      }

      setProfileData(body.profile || null);
      setScreen("profile");
    } catch (err) {
      setError(err.message || "Could not load your profile.");
    } finally {
      setProfileBusy(false);
    }
  };

  const signOut = () => {
    window.localStorage.removeItem("bulkcertify_local_auth");
    setAuthEmail("");
    setAuthPassword("");
    setIsAuthenticated(false);
    setScreen("auth");
    setAuthMode("login");
    setAccount(null);
    setGuestTrial(null);
    setAdminOverview({});
    setAdminClients([]);
    setAdminPayments([]);
    setAdminActivities([]);
    setAdminPlans([]);
    setAdminSearch("");
    setAdminError("");
    setAdminPlansError("");
    setError("");
  };

  const loadAdminPlans = useCallback(async () => {
    if (!isAuthenticated) {
      setAdminPlansError("Please sign in first.");
      return;
    }

    setAdminPlansLoading(true);
    setAdminPlansError("");
    try {
      const res = await authedFetch("/api/admin/plans");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not load plans.");

      setAdminPlans(body.plans || []);
    } catch (err) {
      setAdminPlansError(err.message || "Could not load plans.");
    } finally {
      setAdminPlansLoading(false);
    }
  }, [authedFetch, isAuthenticated]);

  const loadAdminData = useCallback(async (searchValue = adminSearch) => {
    if (!isAuthenticated) {
      setAdminError("Please sign in first.");
      return;
    }

    setAdminLoading(true);
    setAdminError("");
    try {
      const query = searchValue.trim() ? `?search=${encodeURIComponent(searchValue.trim())}` : "";

      const [overviewRes, clientsRes, paymentsRes, activitiesRes, subscriptionSettingsRes, plansRes] = await Promise.all([
        authedFetch("/api/admin/overview"),
        authedFetch(`/api/admin/clients${query}`),
        authedFetch("/api/admin/payments?limit=100"),
        authedFetch("/api/admin/activities?limit=80"),
        authedFetch("/api/admin/subscription-settings"),
        authedFetch("/api/admin/plans"),
      ]);

      const [overviewBody, clientsBody, paymentsBody, activitiesBody, subscriptionSettingsBody, plansBody] = await Promise.all([
        overviewRes.json(),
        clientsRes.json(),
        paymentsRes.json(),
        activitiesRes.json(),
        subscriptionSettingsRes.json(),
        plansRes.json(),
      ]);

      if (!overviewRes.ok) throw new Error(overviewBody.error || "Failed to load admin overview.");
      if (!clientsRes.ok) throw new Error(clientsBody.error || "Failed to load clients.");
      if (!paymentsRes.ok) throw new Error(paymentsBody.error || "Failed to load payments.");
      if (!activitiesRes.ok) throw new Error(activitiesBody.error || "Failed to load activities.");
      if (!subscriptionSettingsRes.ok) throw new Error(subscriptionSettingsBody.error || "Failed to load subscription settings.");
      if (!plansRes.ok) throw new Error(plansBody.error || "Failed to load plans.");

      setAdminOverview(overviewBody.overview || {});
      setAdminClients(clientsBody.clients || []);
      setAdminPayments(paymentsBody.payments || []);
      setAdminActivities(activitiesBody.activities || []);
      setAdminPlans(plansBody.plans || []);
      if (Number.isFinite(Number(subscriptionSettingsBody?.amountInr))) {
        setSubscriptionAmountInr(Math.floor(Number(subscriptionSettingsBody.amountInr)));
      }
      if (Array.isArray(subscriptionSettingsBody?.supportedCurrencies) && subscriptionSettingsBody.supportedCurrencies.length) {
        setSupportedCurrencies([
          ...new Set(
            subscriptionSettingsBody.supportedCurrencies
              .map((currency) => String(currency || "").trim().toUpperCase())
              .filter(Boolean)
          ),
        ]);
      }
    } catch (err) {
      setAdminError(err.message || "Could not load admin panel data.");
    } finally {
      setAdminLoading(false);
    }
  }, [adminSearch, authedFetch, isAuthenticated]);

  const openAdminPanel = async () => {
    if (!account?.isAdmin) {
      setError("Admin access only.");
      return;
    }
    setScreen("admin");
    await loadAdminData("");
  };

  const openAdminPlans = async () => {
    if (!account?.isAdmin) {
      setError("Admin access only.");
      return;
    }
    setScreen("admin-plans");
    await loadAdminPlans();
  };

  const updateAdminSearch = async (value) => {
    setAdminSearch(value);
    await loadAdminData(value);
  };

  const updateClientTrial = async (client, delta) => {
    setAdminClientBusyId(client.id);
    setAdminError("");
    try {
      const res = await authedFetch(`/api/admin/clients/${client.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          trialUsageCount: Math.max(0, Number(client.trialUsageCount || 0) + delta),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not update client.");

      setAdminClients((prev) => prev.map((entry) => (entry.id === client.id ? body.client : entry)));
      await loadAdminData(adminSearch);
    } catch (err) {
      setAdminError(err.message || "Could not update client.");
    } finally {
      setAdminClientBusyId(null);
    }
  };

  const resetClientTrial = async (clientId) => {
    setAdminClientBusyId(clientId);
    setAdminError("");
    try {
      const res = await authedFetch(`/api/admin/clients/${clientId}/reset-trial`, {
        method: "POST",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not reset trial.");

      setAdminClients((prev) => prev.map((entry) => (entry.id === clientId ? body.client : entry)));
      await loadAdminData(adminSearch);
    } catch (err) {
      setAdminError(err.message || "Could not reset trial.");
    } finally {
      setAdminClientBusyId(null);
    }
  };

  const toggleClientSubscription = async (client) => {
    setAdminClientBusyId(client.id);
    setAdminError("");
    try {
      const res = await authedFetch(`/api/admin/clients/${client.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isSubscribed: !client.isSubscribed }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not update subscription.");

      setAdminClients((prev) => prev.map((entry) => (entry.id === client.id ? body.client : entry)));
      await loadAdminData(adminSearch);
    } catch (err) {
      setAdminError(err.message || "Could not update subscription.");
    } finally {
      setAdminClientBusyId(null);
    }
  };

  const deleteClient = async (client) => {
    const confirmed = window.confirm(`Delete client ${client.email}? This cannot be undone.`);
    if (!confirmed) return;

    setAdminClientBusyId(client.id);
    setAdminError("");
    try {
      const res = await authedFetch(`/api/admin/clients/${client.id}`, {
        method: "DELETE",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not delete client.");

      setAdminClients((prev) => prev.filter((entry) => entry.id !== client.id));
      await loadAdminData(adminSearch);
    } catch (err) {
      setAdminError(err.message || "Could not delete client.");
    } finally {
      setAdminClientBusyId(null);
    }
  };

  const editClientUsername = async (client) => {
    const nextUsernameRaw = window.prompt("Enter new username", client.email || "");
    if (nextUsernameRaw === null) return;

    const nextUsername = String(nextUsernameRaw || "").trim().toLowerCase();
    if (!nextUsername) {
      setAdminError("Username cannot be empty.");
      return;
    }

    setAdminClientBusyId(client.id);
    setAdminError("");
    try {
      const res = await authedFetch(`/api/admin/clients/${client.id}/username`, {
        method: "PATCH",
        body: JSON.stringify({ username: nextUsername }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not update username.");

      setAdminClients((prev) => prev.map((entry) => (entry.id === client.id ? body.client : entry)));
      await loadAdminData(adminSearch);
    } catch (err) {
      setAdminError(err.message || "Could not update username.");
    } finally {
      setAdminClientBusyId(null);
    }
  };

  const editClientPassword = async (client) => {
    const nextPassword = window.prompt(`Enter new password for ${client.email}`);
    if (nextPassword === null) return;

    const password = String(nextPassword || "").trim();
    if (!password) {
      setAdminError("Password cannot be empty.");
      return;
    }

    setAdminClientBusyId(client.id);
    setAdminError("");
    try {
      const res = await authedFetch(`/api/admin/clients/${client.id}/password`, {
        method: "PATCH",
        body: JSON.stringify({ password }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not update password.");

      await loadAdminData(adminSearch);
    } catch (err) {
      setAdminError(err.message || "Could not update password.");
    } finally {
      setAdminClientBusyId(null);
    }
  };

  const editSubscriptionAmount = async () => {
    const amountInput = window.prompt(
      "Enter subscription amount in INR",
      String(subscriptionAmountInr || 9)
    );
    if (amountInput === null) return;

    const amountInr = Math.floor(Number(amountInput));
    if (!Number.isFinite(amountInr) || amountInr < 1 || amountInr > 1_000_000) {
      setAdminError("Amount must be an integer between 1 and 1000000 INR.");
      return;
    }

    setAdminSubscriptionBusy(true);
    setAdminError("");
    try {
      const res = await authedFetch("/api/admin/subscription-settings", {
        method: "PATCH",
        body: JSON.stringify({ amountInr }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not update subscription amount.");

      const parsedAmount = Number(body?.amountInr);
      if (Number.isFinite(parsedAmount) && parsedAmount > 0) {
        setSubscriptionAmountInr(Math.floor(parsedAmount));
      }
      await loadAdminData(adminSearch);
      await loadAdminPlans();
    } catch (err) {
      setAdminError(err.message || "Could not update subscription amount.");
    } finally {
      setAdminSubscriptionBusy(false);
    }
  };

  /**
   * Sends a request to the backend to create a new subscription plan.
   * `payload` should contain the plan details, including the multi-currency `prices` object.
   */
  const createAdminPlan = async (payload) => {
    setAdminPlansError("");
    setAdminPlanBusyId("new");
    try {
      const res = await authedFetch("/api/admin/plans", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not create plan.");

      setAdminPlans(body.plans || []);
      await loadSubscriptionSettings();
    } catch (err) {
      setAdminPlansError(err.message || "Could not create plan.");
    } finally {
      setAdminPlanBusyId(null);
    }
  };

  /**
   * Sends a request to the backend to update an existing subscription plan.
   * Modifies the plan with `planId` using the provided `payload`.
   */
  const editAdminPlan = async (planId, payload) => {
    setAdminPlansError("");
    setAdminPlanBusyId(planId);
    try {
      const res = await authedFetch(`/api/admin/plans/${planId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not update plan.");

      setAdminPlans(body.plans || []);
      await loadSubscriptionSettings();
    } catch (err) {
      setAdminPlansError(err.message || "Could not update plan.");
    } finally {
      setAdminPlanBusyId(null);
    }
  };

  const deleteAdminPlan = async (plan) => {
    const confirmed = window.confirm(`Delete plan ${plan.name}?`);
    if (!confirmed) return;

    setAdminPlansError("");
    setAdminPlanBusyId(plan.id);
    try {
      const res = await authedFetch(`/api/admin/plans/${plan.id}`, {
        method: "DELETE",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not delete plan.");

      setAdminPlans(body.plans || []);
      await loadSubscriptionSettings();
    } catch (err) {
      setAdminPlansError(err.message || "Could not delete plan.");
    } finally {
      setAdminPlanBusyId(null);
    }
  };

  const handleExcel = useCallback((file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(new Uint8Array(e.target.result), {
          type: "array",
          cellDates: true,
        });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws, {
          defval: "",
          raw: false,
          dateNF: "yyyy-mm-dd",
        });
        if (!data.length) { setError("Excel file is empty."); return; }
        const cols = Object.keys(data[0]);
        setRows(data);
        setColumns(cols);
        setSelectedCol(cols[0]);
        setError("");
      } catch (err) {
        setError("Could not read Excel: " + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  }, []);

  const records = rows
    .map((row) => ({ row, name: normalizeFieldValue(row[selectedCol]) }))
    .filter((entry) => entry.name);
  const names = records.map((entry) => entry.name);
  const canGenerate =
    !!docxFile &&
    records.length > 0 &&
    (isAuthenticated ? !!account?.canGenerate : !!guestTrial?.canGenerate) &&
    !accountLoading &&
    !guestLoading &&
    !billingBusy;

  const addAttributeRow = () => {
    setExtraAttrs((prev) => [
      ...prev,
      { id: Date.now() + Math.random(), placeholder: "", column: "" },
    ]);
  };

  const updateAttributeRow = (id, key, value) => {
    setExtraAttrs((prev) =>
      prev.map((attr) => (attr.id === id ? { ...attr, [key]: value } : attr))
    );
  };

  const removeAttributeRow = (id) => {
    setExtraAttrs((prev) => prev.filter((attr) => attr.id !== id));
  };

  const downloadSampleDocx = () => {
    triggerDownload(sampleDocxUrl, "Sample_certificate.docx");
  };

  /**
   * Initiates the Razorpay checkout flow.
   * Given the selected `plan` and `selectedCurrency`, it requests an order creation
   * from the backend and then opens the Razorpay popup module.
   */
  const startRazorpayCheckout = async (plan, selectedCurrency) => {
    if (!isAuthenticated) {
      setError("Please sign in before purchasing a subscription.");
      return;
    }

    setError("");
    setBillingBusy(true);
    try {
      const selectedPlan = plan && typeof plan === "object" ? plan : null;
      const res = await authedFetch("/api/razorpay/create-subscription", {
        method: "POST",
        body: JSON.stringify({
          planId: selectedPlan?.id || null,
          currency: selectedCurrency || null,
        }),
      });
      const body = await res.json();

      if (!res.ok) {
        throw new Error(body.error || "Unable to start Razorpay checkout.");
      }

      await loadRazorpayCheckout();

      const razorpay = new window.Razorpay({
        key: body.keyId,
        subscription_id: body.subscriptionId,
        currency: body.currency || "INR",
        name: "Cert/Gen Pro",
        description: "Monthly certificate generator subscription",
        prefill: {
          email: body.email || authEmail,
        },
        theme: {
          color: "#1a1a1a",
        },
        handler: async (response) => {
          try {
            const verifyRes = await authedFetch("/api/razorpay/verify-payment", {
              method: "POST",
              body: JSON.stringify(response),
            });
            const verifyBody = await verifyRes.json();

            if (!verifyRes.ok) {
              throw new Error(verifyBody.error || "Unable to verify Razorpay payment.");
            }

            if (verifyBody.account) {
              setAccount(verifyBody.account);
              setScreen("generator");
            }
          } catch (err) {
            setError(err.message || "Unable to verify Razorpay payment.");
          } finally {
            setBillingBusy(false);
          }
        },
        modal: {
          ondismiss: () => {
            setBillingBusy(false);
          },
        },
      });

      razorpay.on("payment.failed", (response) => {
        setError(response?.error?.description || "Razorpay payment failed.");
        setBillingBusy(false);
      });

      razorpay.open();
    } catch (err) {
      setError(err.message || "Unable to start Razorpay checkout.");
      setBillingBusy(false);
      }
  };

  const generate = async () => {
    setError("");
    let shouldShowUpgrade = false;

    if (!isAuthenticated) {
      try {
        const consumeRes = await publicFetch("/api/guest/consume", { method: "POST" });
        const consumeBody = await consumeRes.json();
        if (!consumeRes.ok || !consumeBody.allowed) {
          setGuestTrial({
            remainingUses: 0,
            canGenerate: false,
          });
          setUpgradeReturnScreen("generator");
          setScreen("upgrade");
          setError(
            consumeBody.message ||
              "Your 1 free guest use is finished. Please sign in to continue."
          );
          return;
        }

        setGuestTrial({
          remainingUses: consumeBody.remainingUses,
          canGenerate: !!consumeBody.canGenerate,
        });
        shouldShowUpgrade = !consumeBody.canGenerate;
      } catch (err) {
        setError(err.message || "Could not validate guest usage.");
        return;
      }
    } else if (!account?.canGenerate) {
      setUpgradeReturnScreen("generator");
      setScreen("upgrade");
      setError("Your free trial is over. Upgrade to Pro to keep generating certificates.");
      return;
    }

    const marker = placeholder.trim();
    if (!marker) {
      setError("Placeholder cannot be empty.");
      return;
    }

    const hasIncompleteAttr = extraAttrs.some((attr) => {
      const ph = attr.placeholder.trim();
      const col = attr.column.trim();
      return (ph && !col) || (!ph && col);
    });

    if (hasIncompleteAttr) {
      setError("Each added attribute must have both placeholder and Excel column selected.");
      return;
    }

    const activeAttrs = extraAttrs
      .map((attr) => ({
        placeholder: attr.placeholder.trim(),
        column: attr.column.trim(),
      }))
      .filter((attr) => attr.placeholder && attr.column);

    if (isAuthenticated) {
      try {
        const consumeRes = await authedFetch("/api/usage/consume", { method: "POST" });
        const consumeBody = await consumeRes.json();

        if (!consumeRes.ok || !consumeBody.allowed) {
          setProgress(null);
          setAccount((prev) => ({
            ...(prev || {}),
            canGenerate: false,
            trialUsageCount: 0,
            isSubscribed: prev?.isSubscribed || false,
          }));
          setUpgradeReturnScreen("generator");
          setScreen("upgrade");
          setError(
            consumeBody.message ||
              "Your free trial is over. Upgrade to Pro to continue generating certificates."
          );
          return;
        }

        shouldShowUpgrade = !consumeBody.canGenerate;

        setAccount((prev) => ({
          ...(prev || {}),
          canGenerate: !!consumeBody.canGenerate,
          trialUsageCount: consumeBody.trialUsageCount,
          isSubscribed: !!consumeBody.isSubscribed,
          isAdmin: !!consumeBody.isAdmin,
        }));
      } catch (err) {
        setError(err.message || "Could not validate trial usage.");
        return;
      }
    }

    setProgress({ pct: 0, msg: "Reading template…", done: false });

    const templateBytes = await docxFile.arrayBuffer();
    const outZip = new JSZip();

    for (let i = 0; i < records.length; i++) {
      const { name, row } = records[i];
      const pct = 10 + (i / records.length) * 85;
      setProgress({ pct, msg: `Generating ${i + 1}/${records.length}: ${name}`, done: false });

      const docZip = await JSZip.loadAsync(templateBytes);
      const xmlFiles = Object.keys(docZip.files).filter(
        (n) => n.endsWith(".xml") || n.endsWith(".rels")
      );
      let foundAnyPrimaryPlaceholder = false;

      for (const xmlName of xmlFiles) {
        let nextXml = await docZip.files[xmlName].async("string");

        const primaryResult = replaceInXml(nextXml, marker, name);
        nextXml = primaryResult.xml;
        if (primaryResult.replaced) {
          foundAnyPrimaryPlaceholder = true;
        }

        for (const attr of activeAttrs) {
          const attrValue = normalizeFieldValue(row[attr.column]);
          const attrResult = replaceInXml(nextXml, attr.placeholder, attrValue);
          nextXml = attrResult.xml;
        }

        docZip.file(xmlName, nextXml);
      }

      if (!foundAnyPrimaryPlaceholder) {
        setProgress(null);
        setError(`Placeholder \"${marker}\" was not found in template. Make sure it exactly matches the text inside the .docx file.`);
        return;
      }

      const docxBlob = await docZip.generateAsync({ type: "blob" });
      const safe =
        name.replace(/[^a-zA-Z0-9 _\-]/g, "").replace(/\s+/g, "_") ||
        "cert_" + (i + 1);

      if (downloadFormat === "docx") {
        outZip.file(safe + ".docx", docxBlob);
      } else if (downloadFormat === "pdf") {
        setProgress({ pct, msg: `Converting to PDF ${i + 1}/${records.length}: ${name}`, done: false });
        const pdfBlob = await convertDocxBlobToPdfBlob(docxBlob);
        outZip.file(safe + ".pdf", pdfBlob);
      } else {
        setProgress({ pct, msg: `Converting to JPG ${i + 1}/${records.length}: ${name}`, done: false });
        const jpgBlob = await convertDocxBlobToJpgBlob(docxBlob);
        outZip.file(safe + ".jpg", jpgBlob);
      }

      await new Promise((r) => setTimeout(r, 0));
    }

    setProgress({ pct: 97, msg: "Creating ZIP…", done: false });
    const zipBlob = await outZip.generateAsync({ type: "blob" });
    setProgress({
      pct: 100,
      msg: `${records.length} certificate${records.length !== 1 ? "s" : ""} generated!`,
      done: true,
    });

    triggerDownload(zipBlob, `certificates_${downloadFormat}.zip`);

    if (shouldShowUpgrade) {
      setUpgradeReturnScreen("generator");
      setScreen("upgrade");
    }
  };

  const guestUsesLeft = Math.max(guestTrial?.remainingUses || 0, 0);
  const accountUsesLeft = Math.max(account?.trialUsageCount || 0, 0);
  const isDarkMode = themeMode === "dark";

  const renderWithThemeToggle = (content) => (
    <>
      {content}
      <button
        type="button"
        className={`theme-toggle-card theme-toggle-fab ${isDarkMode ? "is-dark" : "is-light"}`}
        onClick={() => setThemeMode((prev) => (prev === "dark" ? "light" : "dark"))}
        aria-label={`Switch to ${isDarkMode ? "light" : "dark"} mode`}
        title={`Switch to ${isDarkMode ? "light" : "dark"} mode`}
      >
        <span className="theme-toggle-icon theme-toggle-sun" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="4.5" />
            <path d="M12 2.5v2.2" />
            <path d="M12 19.3v2.2" />
            <path d="M4.9 4.9l1.6 1.6" />
            <path d="M17.5 17.5l1.6 1.6" />
            <path d="M2.5 12h2.2" />
            <path d="M19.3 12h2.2" />
            <path d="M4.9 19.1l1.6-1.6" />
            <path d="M17.5 6.5l1.6-1.6" />
          </svg>
        </span>
        <span className="theme-toggle-icon theme-toggle-moon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.8A8.8 8.8 0 1 1 11.2 3 7.1 7.1 0 0 0 21 12.8Z" />
          </svg>
        </span>
        <span className="theme-toggle-thumb" aria-hidden="true" />
      </button>
    </>
  );

  if (screen === "auth") {
    const loginPageComponent = (
      <LoginPage
        authMode={authMode}
        setAuthMode={setAuthMode}
        authEmail={authEmail}
        setAuthEmail={setAuthEmail}
        authPassword={authPassword}
        setAuthPassword={setAuthPassword}
        authBusy={authBusy}
        authError={authError}
        signIn={signIn}
        continueAsGuest={continueAsGuest}
        guestLoading={guestLoading}
        guestUsesLeft={guestUsesLeft}
        onOpenPolicy={() => openPolicyPage("auth")}
        onGoogleSignIn={handleGoogleSignIn}
        googleBusy={googleBusy}
      />
    );

    if (googleClientId) {
      return renderWithThemeToggle(
        <GoogleOAuthProvider clientId={googleClientId}>
          {loginPageComponent}
        </GoogleOAuthProvider>
      );
    }

    return renderWithThemeToggle(loginPageComponent);
  }

  if (screen === "upgrade") {
    return renderWithThemeToggle(
      <UpgradePage
        isAuthenticated={isAuthenticated}
        account={account}
        billingBusy={billingBusy}
        accountLoading={accountLoading}
        accountUsesLeft={accountUsesLeft}
        plans={publicPlans}
        supportedCurrencies={supportedCurrencies}
        subscriptionAmountInr={subscriptionAmountInr}
        startRazorpayCheckout={startRazorpayCheckout}
        onBack={closeUpgradePage}
        error={error}
        setAuthMode={setAuthMode}
        setScreen={setScreen}
        onOpenPolicy={() => openPolicyPage("upgrade")}
      />
    );
  }

  if (screen === "policy") {
    return renderWithThemeToggle(<PolicyPage onBack={closePolicyPage} />);
  }

  if (screen === "profile") {
    return renderWithThemeToggle(
      <ProfilePage
        profile={profileData}
        loading={profileBusy}
        onBack={() => setScreen("generator")}
      />
    );
  }

  if (screen === "admin") {
    return renderWithThemeToggle(
      <AdminPage
        loading={adminLoading}
        error={adminError}
        overview={adminOverview}
        clients={adminClients}
        payments={adminPayments}
        activities={adminActivities}
        plans={adminPlans}
        subscriptionAmountInr={subscriptionAmountInr}
        subscriptionAmountBusy={adminSubscriptionBusy}
        clientBusyId={adminClientBusyId}
        onBack={() => setScreen("generator")}
        onRefresh={() => loadAdminData(adminSearch)}
        onSearch={updateAdminSearch}
        onUpdateTrial={updateClientTrial}
        onResetTrial={resetClientTrial}
        onToggleSubscription={toggleClientSubscription}
        onDeleteClient={deleteClient}
        onEditUsername={editClientUsername}
        onEditPassword={editClientPassword}
        onEditSubscriptionAmount={editSubscriptionAmount}
        onOpenPlanManager={openAdminPlans}
      />
    );
  }

  if (screen === "admin-plans") {
    return renderWithThemeToggle(
      <AdminPlansPage
        loading={adminPlansLoading}
        busyId={adminPlanBusyId}
        error={adminPlansError}
        plans={adminPlans}
        currencyOptions={supportedCurrencies}
        onBack={() => setScreen("admin")}
        onRefresh={loadAdminPlans}
        onCreatePlan={createAdminPlan}
        onEditPlan={editAdminPlan}
        onDeletePlan={deleteAdminPlan}
      />
    );
  }

  return renderWithThemeToggle(
    <div className="app">
      <div className="live-bg" aria-hidden="true">
        <div className="aurora aurora-a" />
        <div className="aurora aurora-b" />
        <div className="grid-drift" />
      </div>

      <header className="header">
        <div className="badge">
          <span className="badge-dot" />
          Certificate Generator
        </div>
        <h1>Cert&thinsp;/&thinsp;Gen</h1>
        <p className="sub">
          Upload template &amp; student list — download a ZIP of filled certificates
        </p>
      </header>

      <main>
        <section className="account-card">
          {isAuthenticated ? (
            <>
              <div className="account-top">
                <div className="account-meta">
                  <h3>{accountLoading ? "Loading account..." : "Billing Dashboard"}</h3>
                  <p>{account?.email || authEmail || "Signed in"}</p>
                </div>
                <div className="account-top-actions">
                  <button type="button" className="account-btn" onClick={signOut}>
                    Sign Out
                  </button>
                </div>
              </div>

              <div className="account-stats">
                <div className="stat-chip">
                  <span>Status</span>
                  <strong>{account?.isSubscribed ? "Pro Active" : "Free Trial"}</strong>
                </div>
                <div className="stat-chip">
                  <span>Remaining Free Uses</span>
                  <strong>{accountLoading ? "..." : Math.max(account?.trialUsageCount || 0, 0)}</strong>
                </div>
              </div>

              <div className="account-actions">
                {account?.isAdmin && (
                  <button
                    type="button"
                    className="account-btn"
                    onClick={openAdminPanel}
                    disabled={accountLoading}
                  >
                    Admin Panel
                  </button>
                )}
                <button
                  type="button"
                  className="account-btn"
                  onClick={openProfilePage}
                  disabled={accountLoading || profileBusy}
                >
                  {profileBusy ? "Opening Profile..." : "View Profile"}
                </button>
                {!account?.isSubscribed ? (
                  <button
                    type="button"
                    className="account-btn"
                    onClick={() => {
                      setUpgradeReturnScreen("generator");
                      setScreen("upgrade");
                    }}
                    disabled={billingBusy || accountLoading}
                  >
                    Upgrade with Razorpay
                  </button>
                ) : (
                  <button type="button" className="account-btn" disabled>
                    Subscription Active
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="account-line">
                <div>
                  <h3>Guest Mode</h3>
                  <p>
                    {guestLoading
                      ? "Checking free uses..."
                      : `${guestUsesLeft} guest use${guestUsesLeft === 1 ? "" : "s"} left before upgrade.`}
                  </p>
                </div>
                <button
                  type="button"
                  className="account-btn"
                  onClick={() => {
                    setAuthMode("login");
                    setScreen("auth");
                  }}
                >
                  Sign In / Sign Up
                </button>
              </div>

              <div className="account-stats">
                <div className="stat-chip">
                  <span>Status</span>
                  <strong>Guest Trial</strong>
                </div>
                <div className="stat-chip">
                  <span>Next step</span>
                  <strong>Upgrade after free use ends</strong>
                </div>
              </div>
            </>
          )}
        </section>

        {/* Step 1 */}
        <div className="step-card active">
          <div className="step-num">01 — Upload Files</div>
          <button type="button" className="sample-btn" onClick={downloadSampleDocx}>
            Download Sample DOCX
          </button>
          <div className="drop-row">
            <DropZone
              accept=".docx"
              iconColor="#3b82f6"
              iconBg="#dbeafe"
              title="Certificate Template (.docx)"
              hint="Drop the DOCX template you provided or click to browse"
              filled={!!docxFile}
              fileName={docxFile?.name}
              onFile={(f) => { setDocxFile(f); setError(""); }}
            />
            <DropZone
              accept=".xlsx,.xls"
              iconColor="#22c55e"
              iconBg="#dcfce7"
              title="Student List (.xlsx / .xls)"
              hint="Drop your Excel file here or click to browse"
              filled={rows.length > 0}
              fileName={rows.length > 0 ? `${rows.length} students loaded` : ""}
              onFile={handleExcel}
            />
          </div>
          <div className="sample-hint">Use your provided DOCX template and Excel list to generate certificates.</div>
        </div>

        {/* Step 2 */}
        <div className="step-card">
          <div className="settings-head">
            <div className="step-num">02 — Settings</div>
            <button type="button" className="add-attr-btn" onClick={addAttributeRow}>
              <span aria-hidden="true">+</span>
              Add Attribute
            </button>
          </div>
          <div className="settings-row">
            <div className="field">
              <label htmlFor="placeholder">Placeholder in template</label>
              <input
                id="placeholder"
                type="text"
                value={placeholder}
                onChange={(e) => setPlaceholder(e.target.value)}
                placeholder="{{NAME}}"
              />
              <span className="field-hint">Text in your template to replace</span>
            </div>
            <div className="field">
              <label htmlFor="col-select">Name column</label>
              <select
                id="col-select"
                value={selectedCol}
                onChange={(e) => setSelectedCol(e.target.value)}
                disabled={!columns.length}
              >
                {columns.length === 0 ? (
                  <option>Upload Excel first</option>
                ) : (
                  columns.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))
                )}
              </select>
              <span className="field-hint">Column containing student names</span>
            </div>
          </div>

          {extraAttrs.length > 0 && (
            <div className="attrs-wrap">
              {extraAttrs.map((attr, idx) => (
                <div className="attr-row" key={attr.id}>
                  <button
                    type="button"
                    className="delete-attr-btn"
                    onClick={() => removeAttributeRow(attr.id)}
                    aria-label={`Delete attribute ${idx + 1}`}
                    title="Delete attribute"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="3 6 5 6 21 6"/>
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                      <path d="M10 11v6"/>
                      <path d="M14 11v6"/>
                      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                    </svg>
                  </button>
                  <div className="field">
                    <label htmlFor={`extra-placeholder-${attr.id}`}>Attribute {idx + 1} placeholder</label>
                    <input
                      id={`extra-placeholder-${attr.id}`}
                      type="text"
                      value={attr.placeholder}
                      onChange={(e) => updateAttributeRow(attr.id, "placeholder", e.target.value)}
                      placeholder="{{COURSE}}"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`extra-col-${attr.id}`}>Excel column</label>
                    <select
                      id={`extra-col-${attr.id}`}
                      value={attr.column}
                      onChange={(e) => updateAttributeRow(attr.id, "column", e.target.value)}
                      disabled={!columns.length}
                    >
                      {columns.length === 0 ? (
                        <option value="">Upload Excel first</option>
                      ) : (
                        <>
                          <option value="">Select column</option>
                          {columns.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </>
                      )}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="settings-row">
            <div className="field">
              <label htmlFor="download-format">Download format</label>
              <select
                id="download-format"
                value={downloadFormat}
                onChange={(e) => setDownloadFormat(e.target.value)}
              >
                <option value="docx">DOCX (.docx)</option>
                <option value="pdf">PDF (.pdf)</option>
                <option value="jpg">JPG (.jpg)</option>
              </select>
              <span className="field-hint">Choose output format for generated certificates</span>
            </div>
          </div>

          {names.length > 0 && (
            <div className="preview-pill">
              <span>{names.length} student{names.length !== 1 ? "s" : ""} —&nbsp;</span>
              <span className="preview-names">
                {names.slice(0, 3).join(", ")}{names.length > 3 ? " …" : ""}
              </span>
            </div>
          )}
        </div>

        {error && <div className="error-card">{error}</div>}

        <button className="btn-gen" disabled={!canGenerate} onClick={generate}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          {!isAuthenticated
            ? guestLoading
              ? "Checking Free Uses..."
              : guestTrial?.canGenerate
                ? `Generate (Free Uses Left: ${Math.max(guestTrial?.remainingUses || 0, 0)})`
                : "Sign In to Continue"
            : accountLoading
              ? "Checking Account..."
              : `Generate & Download ${downloadFormat.toUpperCase()} ZIP`}
        </button>

        {progress && <ProgressCard progress={progress} />}
      </main>

      <footer>
        All processing happens in your browser — no data is uploaded anywhere.
        <button type="button" className="footer-link" onClick={() => openPolicyPage("generator")}>
          Privacy Policy
        </button>
      </footer>
    </div>
  );
}
