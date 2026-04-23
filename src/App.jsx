import { useState, useCallback, useEffect } from "react";
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
import "./App.css";
import sampleDocxUrl from "../Sample_certificate.docx";


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
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [screen, setScreen] = useState("generator");
  const [policyReturnScreen, setPolicyReturnScreen] = useState("generator");
  const [authMode, setAuthMode] = useState("login");
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);

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
  const [error, setError] = useState("");

  const getApiUrl = useCallback(
    (path) => (apiBase ? `${apiBase}${path}` : path),
    [apiBase]
  );

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

    const isFlowScreen =
      screen === "generator" ||
      screen === "auth" ||
      screen === "upgrade";

    if (!isFlowScreen) {
      return;
    }

    if (isAuthenticated) {
      if (account?.isSubscribed) {
        setScreen("generator");
      } else if (!accountLoading && account && !account.canGenerate) {
        setScreen("upgrade");
      }
      return;
    }

    if (screen === "upgrade") {
      return;
    }

    if (guestTrial && !guestTrial.canGenerate && screen === "generator") {
      setScreen("upgrade");
    }
  }, [account, accountLoading, authLoading, guestTrial, isAuthenticated, screen]);

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

  const signIn = async (event) => {
    event.preventDefault();
    setAuthError("");

    const email = authEmail.trim().toLowerCase();
    if (!email) {
      setAuthError("Enter an email address to continue.");
      return;
    }

    if (!authPassword.trim()) {
      setAuthError("Enter any password to use the local placeholder sign-in.");
      return;
    }

    setAuthBusy(true);
    try {
      window.localStorage.setItem("bulkcertify_local_auth", JSON.stringify({ email }));
      setAuthEmail(email);
      setIsAuthenticated(true);
      setScreen("generator");
      setAccount(null);
      setError("");
    } finally {
      setAuthBusy(false);
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
    setError("");
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

  const startRazorpayCheckout = async () => {
    if (!isAuthenticated) {
      setError("Please sign in before purchasing a subscription.");
      return;
    }

    setError("");
    setBillingBusy(true);
    try {
      const res = await authedFetch("/api/razorpay/create-subscription", {
        method: "POST",
      });
      const body = await res.json();

      if (!res.ok) {
        throw new Error(body.error || "Unable to start Razorpay checkout.");
      }

      await loadRazorpayCheckout();

      const razorpay = new window.Razorpay({
        key: body.keyId,
        subscription_id: body.subscriptionId,
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
          setScreen("upgrade");
          setError(
            consumeBody.message ||
              "Your 3 free guest uses are finished. Please sign in to continue."
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
          setScreen("upgrade");
          setError(
            consumeBody.message ||
              "Your free trial is over. Upgrade to Pro to continue generating certificates."
          );
          return;
        }

        shouldShowUpgrade = !consumeBody.isSubscribed && (consumeBody.trialUsageCount || 0) === 0;

        setAccount((prev) => ({
          ...(prev || {}),
          canGenerate: consumeBody.isSubscribed || consumeBody.trialUsageCount > 0,
          trialUsageCount: consumeBody.trialUsageCount,
          isSubscribed: !!consumeBody.isSubscribed,
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
      setScreen("upgrade");
    }
  };

  const guestUsesLeft = Math.max(guestTrial?.remainingUses || 0, 0);
  const accountUsesLeft = Math.max(account?.trialUsageCount || 0, 0);

  if (screen === "auth") {
    return (
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
      />
    );
  }

  if (screen === "upgrade") {
    return (
      <UpgradePage
        isAuthenticated={isAuthenticated}
        account={account}
        billingBusy={billingBusy}
        accountLoading={accountLoading}
        accountUsesLeft={accountUsesLeft}
        startRazorpayCheckout={startRazorpayCheckout}
        error={error}
        setAuthMode={setAuthMode}
        setScreen={setScreen}
        onOpenPolicy={() => openPolicyPage("upgrade")}
      />
    );
  }

  if (screen === "policy") {
    return <PolicyPage onBack={closePolicyPage} />;
  }

  if (screen === "profile") {
    return (
      <ProfilePage
        profile={profileData}
        loading={profileBusy}
        onBack={() => setScreen("generator")}
      />
    );
  }

  return (
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
                <button type="button" className="account-btn" onClick={signOut}>
                  Sign Out
                </button>
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
                    onClick={startRazorpayCheckout}
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
                  <strong>Upgrade after 3 uses</strong>
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
