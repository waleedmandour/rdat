import React, { useState, useCallback, useEffect } from "react";
import { useLanguage } from "../context/LanguageContext";
import { useDualStorage } from "../hooks/useDualStorage";
import { useWorkspaceStore } from "../stores/workspace-store";
import {
  Upload,
  Database,
  Search,
  CheckCircle2,
  XSquare,
  Trash2,
  AlertCircle,
  Plus,
  Pencil,
  Save,
  X,
} from "lucide-react";
import { GlossaryEntry } from "../types";
import { getAllofStore, deleteFromStore } from "../lib/dual-storage";

// ─── Reference DB catalog ──────────────────────────────────────────
// Each entry maps a stable dbId to the seed entries that get imported
// when the user clicks "Download". The `source_db` field on every
// imported entry lets us later remove exactly that DB's rows when the
// user toggles it off (clicks "Use" again). See PHASE 2 tasks 2.3/2.4.
//
// Multiple reference DBs can be "in use" simultaneously — the data
// model already allows their rows to coexist in IndexedDB, and the
// LTE indexes all of them together. The "Use" button is therefore a
// toggle: clicking it when already downloaded removes that DB's
// entries; clicking "Download" imports them and marks the DB as
// downloaded. We chose the toggle model over a single-active-DB
// model because (a) it matches the existing data model and (b) the
// project owner's intent wasn't confirmed in the brief — toggle is
// the more flexible default. If exclusive single-DB use is later
// required, the change is local to this file.
interface RefDbDef {
  id: string;
  label: string;
  desc: string;
  entries: Omit<GlossaryEntry, "id">[];
}

const REFERENCE_DBS: RefDbDef[] = [
  {
    id: "wipo",
    label: "WIPO Pearl Patent (UN IP)",
    desc: "Legal IP patents dictionary (~100 entries)",
    entries: [
      { source_term: "Patent Cooperation Treaty", target_term: "معاهدة التعاون بشأن البراءات", source_lang: "en", target_lang: "ar", pos: "term", domain: "Legal/IP", source_db: "wipo" },
      { source_term: "intellectual property", target_term: "الملكية الفكرية", source_lang: "en", target_lang: "ar", pos: "noun", domain: "Legal", source_db: "wipo" },
      { source_term: "genetic resources", target_term: "الموارد الوراثية", source_lang: "en", target_lang: "ar", pos: "noun", domain: "IP", source_db: "wipo" },
      { source_term: "industrial design", target_term: "التصميم الصناعي", source_lang: "en", target_lang: "ar", pos: "noun", domain: "IP", source_db: "wipo" },
    ],
  },
  {
    id: "microsoft",
    label: "Microsoft Tech Terminology",
    desc: "Software, Cloud and localization terminology",
    entries: [
      { source_term: "operating system", target_term: "نظام التشغيل", source_lang: "en", target_lang: "ar", pos: "noun", domain: "IT", source_db: "microsoft" },
      { source_term: "cloud infrastructure", target_term: "البنية التحتية السحابية", source_lang: "en", target_lang: "ar", pos: "noun", domain: "Tech", source_db: "microsoft" },
      { source_term: "virtual machine", target_term: "آلة افتراضية", source_lang: "en", target_lang: "ar", pos: "noun", domain: "IT", source_db: "microsoft" },
      { source_term: "user authentication", target_term: "مصادقة المستخدم", source_lang: "en", target_lang: "ar", pos: "noun", domain: "Security", source_db: "microsoft" },
    ],
  },
  {
    id: "opus",
    label: "OPUS Wikipedia Parallel Corpus",
    desc: "Open encyclopedic bilingual data (~400 entries)",
    entries: Array.from({ length: 400 }, (_, i) => ({
      source_term: `Term Segment Reference #${i}`,
      target_term: `مرجع جزء المصطلح رقم #${i}`,
      source_lang: "en",
      target_lang: "ar",
      pos: "phrase",
      domain: "Corpus",
      source_db: "opus",
    })),
  },
];

export function GlossaryView() {
  const { locale, t } = useLanguage();
  const isRTL = locale === "ar";

  // Active translation direction — used to set source_lang/target_lang
  // correctly on manually-added and JSON-uploaded entries (PHASE 3
  // task 3.2). Reference-DB entries and the SEED_CORPUS loader keep
  // their hardcoded "en"/"ar" because those datasets are intrinsically
  // English-source → Arabic-target regardless of the active direction.
  const direction = useWorkspaceStore((s) => s.direction);
  const isArToEn = direction === "ar-en";
  const activeSourceLang = isArToEn ? "ar" : "en";
  const activeTargetLang = isArToEn ? "en" : "ar";
  const activeSourceLabel = isArToEn
    ? (isRTL ? "المصطلح بالعربية" : "Arabic term")
    : (isRTL ? "المصطلح بالإنجليزية" : "English term");
  const activeTargetLabel = isArToEn
    ? (isRTL ? "الترجمة بالإنجليزية" : "English translation")
    : (isRTL ? "الترجمة بالعربية" : "Arabic translation");

  const {
    glossaryCount,
    addGlossary,
    removeGlossary,
    clearGlossary,
    importGlossary,
    updateGlossary,
    refreshCounts,
    downloadedDbs,
    markDbDownloaded,
    unmarkDbDownloaded,
  } = useDualStorage();

  const [searchTerm, setSearchTerm] = useState("");
  const [entries, setEntries] = useState<GlossaryEntry[]>([]);
  const [newTerm, setNewTerm] = useState({ source: "", target: "", domain: "general" });
  const [uploadStatus, setUploadStatus] = useState<"idle" | "importing" | "success" | "error">("idle");
  const [importProgress, setImportProgress] = useState(0);
  const [downloadingDb, setDownloadingDb] = useState<string | null>(null);

  // Inline-editing state (PHASE 2 task 2.4). When editingId is non-null,
  // the row with that id renders as an editable form bound to editDraft.
  // Saving calls updateGlossary(editingId, editDraft) and refreshes the
  // LTE via refreshCounts().
  const [editingId, setEditingId] = useState<number | string | null>(null);
  const [editDraft, setEditDraft] = useState<{ source_term: string; target_term: string; domain: string }>({
    source_term: "",
    target_term: "",
    domain: "",
  });

  // Load glossary entries from IndexedDB on component load
  const loadGlossaryEntries = useCallback(async () => {
    try {
      const list = await getAllofStore<GlossaryEntry>("glossary");
      setEntries(list);
    } catch (e) {
      console.error("[Glossary] Loading failed:", e);
    }
  }, []);

  useEffect(() => {
    loadGlossaryEntries();
  }, [loadGlossaryEntries, glossaryCount]);

  const handleCustomFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setUploadStatus("importing");
      setImportProgress(0);

      try {
        const text = await file.text();
        const rawData = JSON.parse(text);

        // Map different glossary fields for flexibility
        if (!Array.isArray(rawData)) {
          throw new Error("Invalid format: Must be a JSON array of translation pairs");
        }

        const validEntries: GlossaryEntry[] = rawData.map((item, idx) => {
          // Field-name flexibility: accept any of {en, source_term, source}
          // for the source side and {ar, target_term, target} for the
          // target side. The semantic is "first value = source, second
          // value = target" regardless of which language that is — the
          // language tags come from the active direction (or from the
          // row's explicit source_lang/target_lang fields if present).
          // See PHASE 3 task 3.2.
          const srcVal = item.en || item.source_term || item.source || "";
          const tgtVal = item.ar || item.target_term || item.target || "";
          if (!srcVal || !tgtVal) {
            throw new Error(`Row ${idx + 1} is missing a valid source or target value.`);
          }
          // Audit fix #7: do NOT compute a numeric id client-side.
          // Previously this was `id: Date.now() + idx` which could
          // collide with the reference-DB id ranges (10000+/20000+/30000+)
          // and silently overwrite user data on upsert. Now we omit
          // `id` entirely and let IndexedDB's autoIncrement handle it.
          // If the JSON includes an explicit string `id`, honour it.
          const entry: GlossaryEntry = {
            id: typeof item.id === "string" ? item.id : (typeof item.id === "number" ? item.id : 0),
            source_term: String(srcVal).trim(),
            target_term: String(tgtVal).trim(),
            // Honour explicit per-row language tags if the JSON
            // provides them; otherwise derive from the active
            // workspace direction so an AR→EN user uploading an
            // AR→EN JSON gets source_lang="ar", target_lang="en".
            source_lang: item.source_lang || activeSourceLang,
            target_lang: item.target_lang || activeTargetLang,
            pos: item.pos || item.type || "noun",
            domain: item.domain || "general"
          };
          // If no explicit id, delete the placeholder so IndexedDB
          // autoIncrements. (We can't conditionally omit a property
          // in an object literal, so set then delete.)
          if (typeof item.id !== "string" && typeof item.id !== "number") {
            delete entry.id;
          }
          return entry;
        });

        // Perform chunked batch-writing to keep browser highly responsive
        await importGlossary(validEntries, (progress) => {
          setImportProgress(progress);
        });

        setUploadStatus("success");
        setTimeout(() => setUploadStatus("idle"), 3000);
        await loadGlossaryEntries();
      } catch (err: any) {
        console.error("[Glossary] Upload failed:", err);
        setUploadStatus("error");
        setTimeout(() => setUploadStatus("idle"), 4000);
      }

      e.target.value = "";
    },
    [importGlossary, loadGlossaryEntries, activeSourceLang, activeTargetLang]
  );

  /**
   * Download (import) a reference DB's entries into IndexedDB, then
   * persist the DB id in sync_meta so the button label flips from
   * "Download" to "Use" and survives reloads. See PHASE 2 task 2.3.
   */
  const handleDownloadDb = useCallback(async (dbId: string) => {
    const def = REFERENCE_DBS.find((d) => d.id === dbId);
    if (!def) return;

    setDownloadingDb(dbId);
    setImportProgress(0);

    // Simulate multi-phase pre-fetched content download progress so
    // the user sees the bar fill even for tiny hardcoded datasets.
    for (let p = 10; p <= 100; p += 10) {
      setImportProgress(p);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }

    try {
      // Audit fix #7: use string ids of the form "{dbId}-{idx}" so
      // reference-DB entries can NEVER collide with auto-incremented
      // user entries (which are numeric) or with each other across DBs.
      // The string prefix also lets us identify and remove all entries
      // for a specific DB when the user toggles it off via "Use".
      const tagged: GlossaryEntry[] = def.entries.map((e, idx) => ({
        ...e,
        id: `${dbId}-${idx}`,
      }));

      await importGlossary(tagged, (p) => setImportProgress(p));
      await markDbDownloaded(dbId);
    } catch (e) {
      console.error("[Glossary] DB download failed:", e);
    } finally {
      setDownloadingDb(null);
      await loadGlossaryEntries();
    }
  }, [importGlossary, loadGlossaryEntries, markDbDownloaded]);

  /**
   * Toggle a previously-downloaded reference DB off: remove all its
   * entries from IndexedDB and unmark it in sync_meta. The button
   * label then flips back to "Download". See PHASE 2 task 2.3.
   */
  const handleUnuseDb = useCallback(async (dbId: string) => {
    try {
      // Remove every glossary row whose source_db matches. Manually
      // built entries (no source_db) and other DBs' rows are left
      // untouched.
      const all = await getAllofStore<GlossaryEntry>("glossary");
      const toRemove = all.filter((e) => e.source_db === dbId);
      for (const e of toRemove) {
        if (e.id != null) await deleteFromStore("glossary", e.id);
      }
      await unmarkDbDownloaded(dbId);
      await refreshCounts();
      await loadGlossaryEntries();
    } catch (e) {
      console.error("[Glossary] Failed to remove DB:", e);
    }
  }, [unmarkDbDownloaded, refreshCounts, loadGlossaryEntries]);

  const filteredEntries = entries.filter((item) => {
    const q = searchTerm.toLowerCase();
    return (
      item.source_term.toLowerCase().includes(q) ||
      item.target_term.toLowerCase().includes(q)
    );
  });

  const handleAddTerm = useCallback(async () => {
    if (!newTerm.source.trim() || !newTerm.target.trim()) return;
    try {
      await addGlossary({
        source_term: newTerm.source.trim(),
        target_term: newTerm.target.trim(),
        // Derive language tags from the active workspace direction so
        // an AR→EN user adding a term gets source_lang="ar",
        // target_lang="en". Previously hardcoded to "en"/"ar".
        // See PHASE 3 task 3.2.
        source_lang: activeSourceLang,
        target_lang: activeTargetLang,
        pos: "term",
        domain: newTerm.domain || "general",
      });
      setNewTerm({ source: "", target: "", domain: "general" });
      await loadGlossaryEntries();
    } catch (e) {
      console.error("[Glossary] Add term failed:", e);
    }
  }, [newTerm, addGlossary, loadGlossaryEntries, activeSourceLang, activeTargetLang]);

  /** Begin inline editing for a row. Pre-fills the draft from the entry. */
  const beginEdit = useCallback((entry: GlossaryEntry) => {
    setEditingId(entry.id);
    setEditDraft({
      source_term: entry.source_term,
      target_term: entry.target_term,
      domain: entry.domain || "",
    });
  }, []);

  /** Cancel inline editing without saving. */
  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditDraft({ source_term: "", target_term: "", domain: "" });
  }, []);

  /**
   * Save the in-progress edit. Calls updateGlossary() which upserts
   * via IndexedDB put(); refreshCounts() then rebuilds the LTE so
   * ghost-text suggestions reflect the edited term immediately.
   * See PHASE 2 task 2.4.
   */
  const saveEdit = useCallback(async () => {
    if (editingId == null) return;
    if (!editDraft.source_term.trim() || !editDraft.target_term.trim()) {
      cancelEdit();
      return;
    }
    try {
      await updateGlossary(editingId, {
        source_term: editDraft.source_term.trim(),
        target_term: editDraft.target_term.trim(),
        domain: editDraft.domain.trim() || "general",
      });
      cancelEdit();
      await loadGlossaryEntries();
    } catch (e) {
      console.error("[Glossary] Edit save failed:", e);
    }
  }, [editingId, editDraft, updateGlossary, loadGlossaryEntries, cancelEdit]);

  /**
   * Render a single reference DB card's action area. Three states:
   *   - downloading: animated progress percentage
   *   - downloaded:  "Use" button (success-coloured) that toggles the DB off
   *   - not yet:     "Download" button that triggers import + persist
   *
   * The brief asked for "Use" rather than the previous non-interactive
   * "Active" label — we make "Use" a real toggle so the user can
   * remove a DB they no longer want. Multiple DBs can be "in use"
   * simultaneously; see REFERENCE_DBS comment above.
   */
  const renderDbAction = (dbId: string) => {
    const isDownloading = downloadingDb === dbId;
    const isDownloaded = downloadedDbs.includes(dbId);

    if (isDownloading) {
      return (
        <span className="text-primary font-bold animate-pulse font-mono text-[10px]">
          {importProgress}%
        </span>
      );
    }
    if (isDownloaded) {
      return (
        <button
          onClick={() => handleUnuseDb(dbId)}
          className="p-1 px-2.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 text-[10.5px] font-bold cursor-pointer transition-all border border-emerald-500/20 flex items-center gap-1"
          title={isRTL ? "إزالة قاعدة البيانات هذه" : "Remove this database"}
        >
          <CheckCircle2 className="w-3 h-3" />
          {isRTL ? "استخدام" : "Use"}
        </button>
      );
    }
    return (
      <button
        onClick={() => handleDownloadDb(dbId)}
        className="p-1 px-2.5 rounded bg-primary/10 text-primary hover:bg-primary/20 text-[10.5px] font-bold cursor-pointer transition-all"
      >
        {isRTL ? "تنزيل" : "Download"}
      </button>
    );
  };

  return (
    <div className="h-full overflow-y-auto bg-background p-6" dir={isRTL ? "rtl" : "ltr"}>
      <div className="max-w-4xl mx-auto space-y-6">

        {/* Header Dashboard section */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-6">
          <div>
            <h1 className="text-xl font-black text-foreground">
              {t("nav.glossary")}
            </h1>
            <p className="text-xs text-muted-foreground mt-1">
              {glossaryCount} {isRTL ? "مصطلحات نشطة في الذاكرة المحلية" : "active terminologies indexed in offline storage"}
            </p>
          </div>

          {/* Upload / Clear Controls */}
          <div className="flex items-center gap-2">
            {uploadStatus === "importing" && (
              <span className="flex items-center gap-2 text-xs text-primary animate-pulse font-mono">
                <span>{isRTL ? `جاري الاستيراد... (${importProgress}%)` : `Importing... (${importProgress}%)`}</span>
              </span>
            )}
            {uploadStatus === "success" && (
              <span className="flex items-center gap-1.5 text-xs text-emerald-500 font-semibold bg-emerald-500/10 px-3 py-1.5 rounded-lg">
                <CheckCircle2 className="w-4 h-4" />
                <span>{isRTL ? "اكتمل الاستيراد" : "Import Successful"}</span>
              </span>
            )}
            {uploadStatus === "error" && (
              <span className="flex items-center gap-1.5 text-xs text-amber-500 font-semibold bg-amber-500/10 px-3 py-1.5 rounded-lg">
                <XSquare className="w-4 h-4" />
                <span>{isRTL ? "فشل الاستيراد" : "Upload Failed"}</span>
              </span>
            )}

            {entries.length > 0 && (
              <button
                onClick={async () => {
                  if (confirm(isRTL ? "هل أنت متأكد من مسح جميع المصطلحات؟" : "Are you sure you want to clear your local database?")) {
                    await clearGlossary();
                    await loadGlossaryEntries();
                  }
                }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-amber-600 bg-amber-500/5 hover:bg-amber-500/10 transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isRTL ? "مسح قاعدة البيانات" : "Clear All"}</span>
              </button>
            )}

            <label className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer select-none">
              <Upload className="w-4 h-4" />
              <span>{isRTL ? "رفع ملف مصطلحات JSON" : "Upload Terminology JSON"}</span>
              <input
                type="file"
                accept=".json"
                onChange={handleCustomFileUpload}
                className="hidden"
                disabled={uploadStatus === "importing"}
              />
            </label>
          </div>
        </div>

        {/* Add Term Form */}
        <div className="bg-surface border border-border rounded-xl p-4 space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
            <Plus className="w-4 h-4 text-primary" />
            {isRTL ? "إضافة مصطلح جديد" : "Add New Term"}
          </h3>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={newTerm.source}
              onChange={(e) => setNewTerm({ ...newTerm, source: e.target.value })}
              placeholder={activeSourceLabel}
              className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:border-primary/50"
              dir={isArToEn ? "rtl" : "ltr"}
            />
            <input
              type="text"
              value={newTerm.target}
              onChange={(e) => setNewTerm({ ...newTerm, target: e.target.value })}
              placeholder={activeTargetLabel}
              className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:border-primary/50"
              dir={isArToEn ? "ltr" : "rtl"}
            />
            <input
              type="text"
              value={newTerm.domain}
              onChange={(e) => setNewTerm({ ...newTerm, domain: e.target.value })}
              placeholder={isRTL ? "المجال" : "Domain"}
              className="sm:w-32 bg-background border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:border-primary/50"
            />
            <button
              onClick={handleAddTerm}
              disabled={!newTerm.source.trim() || !newTerm.target.trim()}
              className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              {isRTL ? "إضافة" : "Add"}
            </button>
          </div>
        </div>

        {/* Database sources Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* Strict Glossaries card */}
          <div className="bg-surface border border-border p-4 rounded-xl space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-1.5">
              <Database className="w-4 h-4" />
              <span>{isRTL ? "القواميس المرجعية المعتمدة (GTR)" : "GTR Reference Glossaries"}</span>
            </h3>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {isRTL ? "قم بتحميل بنوك مصطلحات رسمية مصدقة للبحث الدقيق." : "Download strict authenticated on-device term-to-term reference datasets."}
            </p>

            <div className="space-y-2 pt-2">
              {REFERENCE_DBS.filter((db) => db.id === "wipo" || db.id === "microsoft").map((db) => (
                <div key={db.id} className="flex items-center justify-between p-2.5 rounded-lg bg-background border border-border/50 text-xs">
                  <div>
                    <div className="font-bold text-foreground">{db.label}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{db.desc}</div>
                  </div>
                  {renderDbAction(db.id)}
                </div>
              ))}
            </div>
          </div>

          {/* Parallel Corpora card */}
          <div className="bg-surface border border-border p-4 rounded-xl space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-1.5">
              <Database className="w-4 h-4" />
              <span>{isRTL ? "بنوك نصوص موازية للبحث السياقي" : "Parallel Retrieval Corpora"}</span>
            </h3>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {isRTL ? "تنزيل لغات موازية لدعم المقاربة والمطابقة التلقائية." : "Download contextual databases for phrase lookup and automated translation memory matching."}
            </p>

            <div className="space-y-2 pt-2">
              {REFERENCE_DBS.filter((db) => db.id === "opus").map((db) => (
                <div key={db.id} className="flex items-center justify-between p-2.5 rounded-lg bg-background border border-border/50 text-xs">
                  <div>
                    <div className="font-bold text-foreground">{db.label}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{db.desc}</div>
                  </div>
                  {renderDbAction(db.id)}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Search & Listing */}
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={isRTL ? "ابحث في القاموس عن مصطلح..." : "Search local indexed glossary database..."}
              className="w-full bg-surface border border-border rounded-xl pl-10 pr-4 py-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/50 font-medium"
            />
          </div>

          <div className="bg-surface border border-border rounded-xl overflow-hidden shadow-sm">
            <table className="w-full text-xs text-left" style={{ textAlign: isRTL ? "right" : "left" }}>
              <thead className="bg-muted/20 border-b border-border/50 text-[10.5px] text-muted-foreground font-semibold">
                <tr>
                  <th className="px-5 py-3 uppercase tracking-wider">{isRTL ? "المصطلح الإنكليزي" : "English Term / Source"}</th>
                  <th className="px-1 py-3 text-center">→</th>
                  <th className="px-5 py-3 uppercase tracking-wider">{isRTL ? "الترجمة المقابلة" : "Arabic Translation / Target"}</th>
                  <th className="px-4 py-3 text-center">{isRTL ? "إجراء" : "Action"}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {filteredEntries.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-5 py-10 text-center text-muted-foreground md:py-16">
                      <div className="max-w-[280px] mx-auto space-y-2">
                        <AlertCircle className="w-6 h-6 mx-auto text-muted-foreground/50" />
                        <p className="font-semibold text-xs leading-loose">
                          {isRTL ? "لم يتم العثور على مصطلحات مطابقة" : "No matching terminology found"}
                        </p>
                        <p className="text-[10px] opacity-70">
                          {isRTL
                            ? "قم برفع ملف JSON مخصص أو تنزيل بنك مصطلحات مرجعي لتغذية قاعدة بياناتك المترجمة."
                            : "Upload a terminology JSON file or select and download a pre-loaded collection to seed your glossary."}
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredEntries.slice(0, 100).map((entry) => {
                    const isEditing = editingId === entry.id;
                    return (
                      <tr key={entry.id} className="hover:bg-muted/10 transition-colors">
                        {isEditing ? (
                          <>
                            <td className="px-3 py-2">
                              <input
                                type="text"
                                value={editDraft.source_term}
                                onChange={(e) => setEditDraft({ ...editDraft, source_term: e.target.value })}
                                className="w-full bg-background border border-primary/50 rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-primary"
                                dir="ltr"
                                autoFocus
                              />
                            </td>
                            <td className="px-1 py-3 text-center text-muted-foreground/30 font-medium">→</td>
                            <td className="px-3 py-2">
                              <input
                                type="text"
                                value={editDraft.target_term}
                                onChange={(e) => setEditDraft({ ...editDraft, target_term: e.target.value })}
                                className="w-full bg-background border border-primary/50 rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-primary"
                                dir="rtl"
                              />
                            </td>
                            <td className="px-4 py-3 text-center">
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  onClick={saveEdit}
                                  className="p-1 rounded text-emerald-500 hover:bg-emerald-500/10 cursor-pointer"
                                  title={isRTL ? "حفظ" : "Save"}
                                >
                                  <Save className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={cancelEdit}
                                  className="p-1 rounded text-muted-foreground hover:bg-muted cursor-pointer"
                                  title={isRTL ? "إلغاء" : "Cancel"}
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-5 py-3 font-mono text-foreground font-medium">{entry.source_term}</td>
                            <td className="px-1 py-3 text-center text-muted-foreground/30 font-medium">→</td>
                            <td className="px-5 py-3 text-foreground font-semibold" dir="rtl">{entry.target_term}</td>
                            <td className="px-4 py-3 text-center">
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  onClick={() => beginEdit(entry)}
                                  className="p-1 rounded text-primary hover:bg-primary/10 cursor-pointer"
                                  title={isRTL ? "تحرير المصطلح" : "Edit Term"}
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={async () => {
                                    if (entry.id) {
                                      await removeGlossary(entry.id);
                                      await loadGlossaryEntries();
                                    }
                                  }}
                                  className="p-1 rounded text-red-500 hover:bg-red-500/10 cursor-pointer"
                                  title={isRTL ? "حذف المصطلح" : "Delete Term"}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>

            {filteredEntries.length > 100 && (
              <div className="bg-muted/10 p-2 text-center text-[10px] text-muted-foreground border-t border-border/40">
                {isRTL
                  ? `يعرض أول 100 من أصل ${filteredEntries.length} نتيجة`
                  : `Showing first 100 of ${filteredEntries.length} terminology entries`}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
export default GlossaryView;
