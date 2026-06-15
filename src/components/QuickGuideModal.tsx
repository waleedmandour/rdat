import React from "react";
import { useLanguage } from "../context/LanguageContext";
import { X, HelpCircle, Lightbulb, GraduationCap, Github, Mail } from "lucide-react";

interface QuickGuideModalProps {
  open: boolean;
  onClose: () => void;
}

export function QuickGuideModal({ open, onClose }: QuickGuideModalProps) {
  const { locale, t } = useLanguage();
  const isRTL = locale === "ar";

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in" dir={isRTL ? "rtl" : "ltr"}>
      <div className="bg-surface border border-border rounded-2xl max-w-lg w-full p-6 shadow-2xl relative space-y-4">
        
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-2.5">
          <HelpCircle className="w-5 h-5 text-primary" />
          <h2 className="text-sm font-black text-foreground">
            {isRTL ? "دليل الاختصارات الذكية" : "Predictive Shortcuts Guide"}
          </h2>
        </div>

        <p className="text-[11px] text-muted-foreground leading-relaxed">
          {isRTL 
            ? "يساعدك محرر RDAT على صياغة الترجمات بسرعة وسلاسة غوغل تماماً! أثناء كتابتك للترجمة في المربعات، ستظهر كلمات مقترحة باللون الرمادي الفاتح:" 
            : "RDAT Copilot features Google-like ghost-text predictive suggestions. As you type, the system projects grey placeholder translations matching your context:"}
        </p>

        {/* Shortcuts list container */}
        <div className="space-y-2 pt-2">
          {[
            { keys: "Tab", action: isRTL ? "قبول الاقتراح بشكل كامل ومباشر" : "Accept entire inline ghost suggestion immediately", tip: isRTL ? "اختصار فائق السرعة" : "Highly recommended co-writing key" },
            { keys: "Ctrl + →", action: isRTL ? "قبول الكلمة الأولى فقط من الاقتراح الرمادي" : "Accept the next word of the suggestion incrementially" },
            { keys: "Alt + ]", action: isRTL ? "التنقل التلقائي بين خيارات الترجمة البديلة" : "Cycle through alternate translation candidates" },
            { keys: "Esc", action: isRTL ? "تجاهل الاقتراح الحالي مؤقتاً" : "Temporarily dismiss suggestions to type freely" }
          ].map((sc, idx) => (
            <div key={idx} className="p-3 bg-background border border-border/60 rounded-xl flex items-center justify-between text-xs">
              <div className="space-y-0.5">
                <div className="font-semibold text-foreground">{sc.action}</div>
                {sc.tip && <div className="text-[9.5px] text-primary font-bold">{sc.tip}</div>}
              </div>
              <kbd className="bg-surface border border-border px-2 py-1 rounded font-mono font-bold text-[10px] text-foreground shrink-0 shadow-sm">
                {sc.keys}
              </kbd>
            </div>
          ))}
        </div>

        <div className="flex gap-2 p-3 bg-primary/5 rounded-xl border border-primary/10 text-[10.5px] text-muted-foreground leading-relaxed">
          <Lightbulb className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <span>
            {isRTL 
              ? "نصيحة: يمكنك استيراد قواميس المصطلحات الكبيرة من صفحة 'القواميس' لتعمل ميزة الإتمام التلقائي والبحث حتى دون اتصال بالشبكة!" 
              : "Pro Tip: Upload terminology databases under the 'Glossary' tab so predictive suggestions pull directly from offline indices even if the internet drops!"}
          </span>
        </div>

        {/* Academic Project Credits */}
        <div className="pt-3.5 border-t border-dashed dark:border-white/5 border-border space-y-2 text-[10px] select-text">
          <div className="flex items-center gap-1.5 font-bold text-foreground">
            <GraduationCap className="w-4 h-4 text-primary" />
            <span>
              {isRTL 
                ? "جامعة السلطان قابوس، سلطنة عمان • ٢٠٢٦" 
                : "Sultan Qaboos University, Oman • 2026"}
            </span>
          </div>
          <p className="text-slate-400 leading-relaxed font-sans">
            {isRTL 
              ? "تم تطوير الأداة تحت إشراف د. وليد أبو مندور لدعم الباحثين والمترجمين في المجال الأكاديمي." 
              : "Developed under the guidance of Dr. Waleed Mandour to support academic researchers and translator corpora."}
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <a
              href="mailto:w.abumandour@squ.edu.om"
              className="flex items-center gap-1 text-[9.5px] font-bold text-primary hover:underline border border-primary/15 px-2 py-1 rounded-lg bg-primary/5 cursor-pointer"
            >
              <Mail className="w-3 h-3" />
              <span>w.abumandour@squ.edu.om</span>
            </a>
            <a
              href="https://github.com/waleedmandour/rdat"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-[9.5px] font-bold text-slate-300 hover:text-white border dark:border-white/5 border-border px-2 py-1 rounded-lg dark:bg-[#111318] cursor-pointer"
            >
              <Github className="w-3 h-3" />
              <span>rdat</span>
            </a>
          </div>
        </div>

        <div className="text-center pt-2">
          <button
            onClick={onClose}
            className="w-full py-2.5 bg-primary text-primary-foreground font-bold rounded-xl text-xs cursor-pointer shadow-md shadow-primary/10 hover:shadow-primary/20"
          >
            {isRTL ? "فهمت، جاهز للكتابة" : "Got it, ready to write"}
          </button>
        </div>

      </div>
    </div>
  );
}
export function hasSeenGuide() {
  return true;
}
export default QuickGuideModal;
