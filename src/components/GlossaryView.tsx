import React, { useState, useCallback, useEffect } from "react";
import { useLanguage } from "../context/LanguageContext";
import { useDualStorage } from "../hooks/useDualStorage";
import { 
  Upload, 
  Database, 
  Search, 
  ArrowRight, 
  CheckCircle2, 
  XSquare, 
  Trash2,
  Download,
  AlertCircle
} from "lucide-react";
import { GlossaryEntry } from "../types";
import { cn } from "../lib/utils";

export function GlossaryView() {
  const { locale, t } = useLanguage();
  const isRTL = locale === "ar";
  
  const {
    glossaryCount,
    addGlossary,
    removeGlossary,
    clearGlossary,
    importGlossary,
    refreshCounts
  } = useDualStorage();

  const [searchTerm, setSearchTerm] = useState("");
  const [entries, setEntries] = useState<GlossaryEntry[]>([]);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "importing" | "success" | "error">("idle");
  const [importProgress, setImportProgress] = useState(0);
  const [downloadingDb, setDownloadingDb] = useState<string | null>(null);
  const [activeDb, setActiveDb] = useState<string | null>(null);

  // Load glossary entries from IndexedDB on components load
  const loadGlossaryEntries = useCallback(async () => {
    try {
      const { getAllofStore } = await import("../lib/dual-storage");
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
          const enVal = item.en || item.source_term || item.source || "";
          const arVal = item.ar || item.target_term || item.target || "";
          if (!enVal || !arVal) {
            throw new Error(`Row ${idx + 1} is missing a valid 'en' or 'ar' value.`);
          }
          return {
            id: Date.now() + idx,
            source_term: String(enVal).trim(),
            target_term: String(arVal).trim(),
            source_lang: "en",
            target_lang: "ar",
            pos: item.pos || item.type || "noun",
            domain: item.domain || "general"
          };
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
    [importGlossary, loadGlossaryEntries]
  );

  const simulateDownloadDB = useCallback(async (dbId: string) => {
    setDownloadingDb(dbId);
    setImportProgress(0);

    // Simulate multi-phase pre-fetched content download
    for (let p = 10; p <= 100; p += 10) {
      setImportProgress(p);
      await new Promise(resolve => setTimeout(resolve, 150));
    }

    try {
      let databaseEntries: GlossaryEntry[] = [];
      if (dbId === "wipo") {
        databaseEntries = [
          { id: 10001, source_term: "Patent Cooperation Treaty", target_term: "معاهدة التعاون بشأن البراءات", source_lang: "en", target_lang: "ar", pos: "term", domain: "Legal/IP" },
          { id: 10002, source_term: "intellectual property", target_term: "الملكية الفكرية", source_lang: "en", target_lang: "ar", pos: "noun", domain: "Legal" },
          { id: 10003, source_term: "genetic resources", target_term: "الموارد الوراثية", source_lang: "en", target_lang: "ar", pos: "noun", domain: "IP" },
          { id: 10004, source_term: "industrial design", target_term: "التصميم الصناعي", source_lang: "en", target_lang: "ar", pos: "noun", domain: "IP" }
        ];
      } else if (dbId === "microsoft") {
        databaseEntries = [
          { id: 20001, source_term: "operating system", target_term: "نظام التشغيل", source_lang: "en", target_lang: "ar", pos: "noun", domain: "IT" },
          { id: 20002, source_term: "cloud infrastructure", target_term: "البنية التحتية السحابية", source_lang: "en", target_lang: "ar", pos: "noun", domain: "Tech" },
          { id: 20003, source_term: "virtual machine", target_term: "آلة افتراضية", source_lang: "en", target_lang: "ar", pos: "noun", domain: "IT" },
          { id: 20004, source_term: "user authentication", target_term: "مصادقة المستخدم", source_lang: "en", target_lang: "ar", pos: "noun", domain: "Security" }
        ];
      } else {
        // Larger simulated dataset
        for (let i = 0; i < 400; i++) {
          databaseEntries.push({
            id: 30000 + i,
            source_term: `Term Segment Reference #${i}`,
            target_term: `مرجع جزء المصطلح رقم #${i}`,
            source_lang: "en",
            target_lang: "ar",
            pos: "phrase",
            domain: "Corpus"
          });
        }
      }

      await importGlossary(databaseEntries, (p) => setImportProgress(p));
      setActiveDb(dbId);
    } catch (e) {
      console.error(e);
    } finally {
      setDownloadingDb(null);
      await loadGlossaryEntries();
    }
  }, [importGlossary, loadGlossaryEntries]);

  const filteredEntries = entries.filter((item) => {
    const q = searchTerm.toLowerCase();
    return (
      item.source_term.toLowerCase().includes(q) ||
      item.target_term.toLowerCase().includes(q)
    );
  });

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
              {[
                { id: "wipo", label: "WIPO Pearl Patent (UN IP)", desc: "Legal IP patents dictionary (~100 entries)" },
                { id: "microsoft", label: "Microsoft Tech Terminology", desc: "Software, Cloud and localization terminology" }
              ].map((db) => {
                const isLoaded = activeDb === db.id;
                const isDownloading = downloadingDb === db.id;

                return (
                  <div key={db.id} className="flex items-center justify-between p-2.5 rounded-lg bg-background border border-border/50 text-xs">
                    <div>
                      <div className="font-bold text-foreground">{db.label}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">{db.desc}</div>
                    </div>
                    {isDownloading ? (
                      <span className="text-primary font-bold animate-pulse font-mono text-[10px]">{importProgress}%</span>
                    ) : isLoaded ? (
                      <span className="text-emerald-500 font-bold font-mono text-[10px]">{isRTL ? "نشط" : "Active"}</span>
                    ) : (
                      <button
                        onClick={() => simulateDownloadDB(db.id)}
                        className="p-1 px-2.5 rounded bg-primary/10 text-primary hover:bg-primary/20 text-[10.5px] font-bold cursor-pointer transition-all"
                      >
                        {isRTL ? "تنزيل" : "Download"}
                      </button>
                    )}
                  </div>
                );
              })}
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
              {[
                { id: "opus", label: "OPUS Wikipedia Parallel Corpus", desc: "Open encyclopedic bilingual data (~400 entries)" }
              ].map((db) => {
                const isLoaded = activeDb === db.id;
                const isDownloading = downloadingDb === db.id;

                return (
                  <div key={db.id} className="flex items-center justify-between p-2.5 rounded-lg bg-background border border-border/50 text-xs">
                    <div>
                      <div className="font-bold text-foreground">{db.label}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">{db.desc}</div>
                    </div>
                    {isDownloading ? (
                      <span className="text-primary font-bold animate-pulse font-mono text-[10px]">{importProgress}%</span>
                    ) : isLoaded ? (
                      <span className="text-emerald-500 font-bold font-mono text-[10px]">{isRTL ? "نشط" : "Active"}</span>
                    ) : (
                      <button
                        onClick={() => simulateDownloadDB(db.id)}
                        className="p-1 px-2.5 rounded bg-primary/10 text-primary hover:bg-primary/20 text-[10.5px] font-bold cursor-pointer transition-all"
                      >
                        {isRTL ? "تنزيل" : "Download"}
                      </button>
                    )}
                  </div>
                );
              })}
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
              <thead className="bg-[#1e1e1e]/2 bg-muted/20 border-b border-border/50 text-[10.5px] text-muted-foreground font-semibold">
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
                  filteredEntries.slice(0, 100).map((entry) => (
                    <tr key={entry.id} className="hover:bg-muted/10 transition-colors">
                      <td className="px-5 py-3 font-mono text-foreground font-medium">{entry.source_term}</td>
                      <td className="px-1 py-3 text-center text-muted-foreground/30 font-medium">→</td>
                      <td className="px-5 py-3 text-foreground font-semibold" dir="rtl">{entry.target_term}</td>
                      <td className="px-4 py-3 text-center">
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
                      </td>
                    </tr>
                  ))
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
