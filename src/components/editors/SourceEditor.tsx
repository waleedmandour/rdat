import React, { useState, useRef } from "react";
import { useLanguage } from "../../context/LanguageContext";
import { useWorkspaceStore } from "../../stores/workspace-store";
import { useToast } from "../../context/ToastContext";
import { cn } from "../../lib/utils";
import { Upload, X, FileText, CheckCircle2 } from "lucide-react";

interface SourceEditorProps {
  sentences: string[];
  currentIdx: number;
  onSelectIdx: (idx: number) => void;
  hoveredIdx: number | null;
  onHoverIdx: (idx: number | null) => void;
}

export function SourceEditor({
  sentences,
  currentIdx,
  onSelectIdx,
  hoveredIdx,
  onHoverIdx,
}: SourceEditorProps) {
  const { locale } = useLanguage();
  const isRTL = locale === "ar";
  const { showToast } = useToast();

  const { setSourceText, setTargetTexts } = useWorkspaceStore();

  // Importer state
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImportSubmit = () => {
    if (!importText.trim()) {
      showToast(isRTL ? "برجاء إدخال نص أولا!" : "Please write or drop some text first!", "warning");
      return;
    }

    // Split text into paragraphs/sentences
    const parsed = importText
      .split(/(?<=[.!?])\s+|\n+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    if (parsed.length === 0) {
      showToast(isRTL ? "فشل تحليل النص!" : "No valid segments found in text!", "error");
      return;
    }

    setSourceText(importText);
    setTargetTexts(Array(parsed.length).fill(""));
    onSelectIdx(0);
    setIsImportOpen(false);
    setImportText("");

    showToast(
      isRTL
        ? `تم تحميل المستند وتجزئته إلى ${parsed.length} مقطع للتأطير!`
        : `Successfully imported document with ${parsed.length} segments!`,
      "success"
    );
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleFile(files[0]);
    }
  };

  const handleFile = (file: File) => {
    if (file.type !== "text/plain" && !file.name.endsWith(".txt")) {
      showToast(isRTL ? "برجاء إرفاق ملف نصي (.txt) فقط!" : "Only text files (.txt) are supported!", "error");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (text) {
        setImportText(text);
        showToast(isRTL ? "تم تحميل الملف بنجاح!" : "File loaded successfully! Review below:", "success");
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="h-full flex flex-col dark:bg-[#0F1116] bg-background font-sans select-none border-b border-border md:border-b-0 md:border-r">
      {/* Editor Panel Header */}
      <div className="h-10 dark:bg-white/5 bg-surface border-b dark:border-white/5 border-border flex items-center justify-between px-4">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
          {isRTL ? "مستند المصدر — إنكليزي" : "Source Text — English"}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsImportOpen(!isImportOpen)}
            className={cn(
              "p-1 px-2 rounded font-black text-[9px] uppercase tracking-wider flex items-center gap-1 cursor-pointer transition-all",
              isImportOpen
                ? "bg-rose-500/10 text-rose-500 hover:bg-rose-500/20"
                : "bg-primary/10 text-primary hover:bg-primary/20"
            )}
          >
            {isImportOpen ? <X className="w-3 h-3" /> : <Upload className="w-3 h-3" />}
            <span>{isImportOpen ? (isRTL ? "إلغاء لسطح المكتب" : "Cancel") : (isRTL ? "استيراد ملف" : "Import Document")}</span>
          </button>
          <span className="font-mono text-[10px] text-slate-500">EN-US</span>
        </div>
      </div>

      {/* Inline Section for Source document importation */}
      {isImportOpen && (
        <div className="p-4 bg-surface-hover/35 dark:bg-white/[0.02] border-b border-border flex flex-col gap-3 select-text animate-fade-in">
          <div className="text-[10.5px] font-bold text-muted-foreground">
            {isRTL ? "احمل ملفك النصي أو قم بلصق المحتوى أدناه:" : "Upload your translation project source file or paste text below:"}
          </div>
          
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={cn(
              "border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all",
              isDragging
                ? "border-primary bg-primary/5"
                : "border-border hover:border-slate-500/30"
            )}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={(e) => {
                const files = e.target.files;
                if (files && files.length > 0) handleFile(files[0]);
              }}
              className="hidden"
              accept=".txt"
            />
            <Upload className="w-6 h-6 mx-auto mb-1 text-slate-500" />
            <span className="text-[10px] font-bold block text-slate-400">
              {isRTL ? "اسحب وأفلت ملف .txt هنا، أو اضغط للتصفح" : "Drag & drop a .txt file here, or click to browse"}
            </span>
          </div>

          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder={isRTL ? "أو قم بلصق نص المصدر المباشر هنا..." : "Or paste English source document content directly here..."}
            className="w-full text-xs font-sans p-3 bg-background dark:bg-[#0A0B0E] border border-border/80 rounded-lg h-24 focus:outline-none focus:border-primary/50 resize-none"
          />

          <button
            onClick={handleImportSubmit}
            className="w-full p-2 rounded-xl bg-primary hover:bg-primary/95 text-white text-xs font-bold shadow-md cursor-pointer transition-all"
          >
            {isRTL ? "تجزئة وتحميل المستند" : "Segment & Load Project"}
          </button>
        </div>
      )}

      {/* Segment Cards List */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4 scrollbar-thin">
        {sentences.map((sentence, idx) => {
          const isActive = idx === currentIdx;
          const isHovered = idx === hoveredIdx;

          return (
            <div
              key={idx}
              id={`src-seg-${idx}`}
              onClick={() => onSelectIdx(idx)}
              onMouseEnter={() => onHoverIdx(idx)}
              onMouseLeave={() => onHoverIdx(null)}
              className={cn(
                "p-4 border-l-2 transition-all duration-200 cursor-pointer text-left select-text",
                isActive
                  ? "dark:bg-primary/10 bg-primary/5 border-primary text-slate-100 opacity-100 pl-4 py-3"
                  : isHovered
                  ? "dark:bg-white/[0.02] bg-surface-hover border-slate-500/30 opacity-80"
                  : "border-transparent opacity-40 hover:opacity-70"
              )}
            >
              {/* Segment Header Tag */}
              <div className="flex items-center gap-2 mb-1.5 label-tag">
                <span className={cn(
                  "text-[9px] font-mono px-1.5 py-0.5 rounded font-bold tracking-tight",
                  isActive ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
                )}>
                  #{String(idx + 1).padStart(2, "0")}
                </span>
                {isActive && (
                  <span className="text-[9px] text-primary/80 font-semibold uppercase tracking-wider">
                    {isRTL ? "محدد" : "Editing"}
                  </span>
                )}
              </div>

              {/* Sentence Text */}
              <p className={cn(
                "text-sm leading-relaxed font-sans transition-colors duration-150",
                isActive ? "text-foreground font-medium" : "text-muted-foreground"
              )}>
                {sentence}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
export default SourceEditor;
