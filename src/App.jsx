import { useState, useCallback } from "react";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import DropZone from "./components/DropZone";
import ProgressCard from "./components/ProgressCard";
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

function normalizeDocxTextSpacing(xml) {
  return xml.replace(/<w:t([^>]*)>([\s\S]*?)<\/w:t>/g, (_, attrs, text) => {
    const normalized = text
      .replace(/\u00A0/g, " ")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\s+([,.;:!?])/g, "$1")
      .replace(/\(\s+/g, "(")
      .replace(/\s+\)/g, ")");
    return `<w:t${attrs}>${normalized}</w:t>`;
  });
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

export default function App() {
  const [docxFile, setDocxFile] = useState(null);
  const [rows, setRows] = useState([]);
  const [columns, setColumns] = useState([]);
  const [selectedCol, setSelectedCol] = useState("");
  const [placeholder, setPlaceholder] = useState("{{NAME}}");
  const [extraAttrs, setExtraAttrs] = useState([]);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");

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
  const canGenerate = docxFile && records.length > 0;

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

  const generate = async () => {
    setError("");
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

        nextXml = normalizeDocxTextSpacing(nextXml);

        docZip.file(xmlName, nextXml);
      }

      if (!foundAnyPrimaryPlaceholder) {
        setProgress(null);
        setError(`Placeholder \"${marker}\" was not found in template. Make sure it exactly matches the text inside the .docx file.`);
        return;
      }

      const blob = await docZip.generateAsync({ type: "blob" });
      const safe =
        name.replace(/[^a-zA-Z0-9 _\-]/g, "").replace(/\s+/g, "_") ||
        "cert_" + (i + 1);
      outZip.file(safe + ".docx", blob);
      await new Promise((r) => setTimeout(r, 0));
    }

    setProgress({ pct: 97, msg: "Creating ZIP…", done: false });
    const zipBlob = await outZip.generateAsync({ type: "blob" });
    setProgress({
      pct: 100,
      msg: `${records.length} certificate${records.length !== 1 ? "s" : ""} generated!`,
      done: true,
    });

    triggerDownload(zipBlob, "certificates.zip");
  };

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
          Generate &amp; Download ZIP
        </button>

        {progress && <ProgressCard progress={progress} />}
      </main>

      <footer>
        All processing happens in your browser — no data is uploaded anywhere.
      </footer>
    </div>
  );
}
