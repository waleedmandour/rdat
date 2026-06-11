import React from "react";
import { useLanguage } from "../context/LanguageContext";
import { BookOpen, Languages, Sparkles, Command, Github, Mail, GraduationCap, Globe } from "lucide-react";
import { motion } from "motion/react";

interface WelcomeTabProps {
  onStart: () => void;
}

export function WelcomeTab({ onStart }: WelcomeTabProps) {
  const { t, locale } = useLanguage();
  const isRTL = locale === "ar";

  const cardsKeys = ["01", "02", "03"];
  const icons = [Languages, BookOpen, Sparkles];

  return (
    <div className="h-full overflow-y-auto dark:bg-[#0A0B0E] bg-background p-6 md:p-12 select-none" dir={isRTL ? "rtl" : "ltr"}>
      <div className="max-w-4xl mx-auto space-y-12">
        {/* Hero Header */}
        <div className="text-center space-y-4">
          <h1 className="text-4xl md:text-6xl font-black text-foreground tracking-tight leading-tight">
            {t("welcome.greeting")}
          </h1>
          <p className="text-xs md:text-sm text-slate-400 max-w-xl mx-auto leading-relaxed">
            {t("welcome.subtitle")}
          </p>
        </div>

        {/* Feature Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {cardsKeys.map((stepKey, idx) => {
            const Icon = icons[idx];
            const cardData = (t("welcome.cards") as any)[idx] || {
              step: stepKey,
              title: "",
              description: "",
            };

            return (
              <div
                key={stepKey}
                className="dark:bg-white/[0.02] bg-surface border dark:border-white/5 border-border p-5 rounded-2xl flex flex-col gap-4 text-left transition-all hover:scale-[1.01] hover:dark:bg-white/[0.03] hover:border-primary/20 cursor-default"
                style={{ textAlign: isRTL ? "right" : "left" }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold font-mono text-primary/80 bg-primary/10 px-2.5 py-0.5 rounded-md uppercase tracking-wider">
                    {cardData.step}
                  </span>
                  <Icon className="w-4 h-4 text-primary opacity-90" />
                </div>
                <div className="space-y-1.5">
                  <h3 className="font-bold text-sm text-foreground">
                    {cardData.title}
                  </h3>
                  <p className="text-[11px] leading-relaxed text-slate-400">
                    {cardData.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Keyboard Shortcuts Section */}
        <div className="dark:bg-[#111318] bg-surface border dark:border-white/5 border-border p-6 rounded-2xl space-y-4">
          <h3 className="font-bold text-xs uppercase tracking-widest text-slate-500 flex items-center gap-2">
            <Command className="w-4 h-4 text-primary" />
            <span>{t("welcome.shortcuts")}</span>
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            {((t("welcome.shortcutList") as any) || []).map((sc: any, idx: number) => (
              <div
                key={idx}
                className="flex items-center justify-between p-2.5 rounded-xl bg-background/50 dark:bg-[#0A0B0E] border dark:border-white/5 border-border/50 font-mono"
              >
                <span className="text-slate-400 text-[11px]">{sc.action}</span>
                <kbd className="dark:bg-white/10 bg-surface border dark:border-white/10 border-border px-2 py-0.5 rounded text-[10px] text-foreground font-black shadow-sm">
                  {sc.keys}
                </kbd>
              </div>
            ))}
          </div>
        </div>

        {/* Action Button */}
        <div className="text-center pt-2">
          <button
            onClick={onStart}
            className="px-10 py-3.5 rounded-xl bg-primary text-white font-black text-xs uppercase tracking-widest transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer shadow-lg shadow-primary/20 hover:shadow-primary/30"
          >
            {locale === "en" ? "Launch Editor" : "بدء الاستخدام"}
          </button>
        </div>

        {/* Academic & Developer Credentials */}
        <div className="pt-8 border-t dark:border-white/5 border-border mt-12 text-center space-y-4">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-500/5 border border-emerald-500/15 dark:border-emerald-500/20 select-text">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] font-mono uppercase text-emerald-500 font-extrabold tracking-wider">
              {isRTL ? "مرخص بموجب رخصة MIT" : "LICENSED UNDER MIT LICENSE"}
            </span>
          </div>

          <div className="max-w-xl mx-auto dark:bg-[#111318]/50 bg-surface border dark:border-white/5 border-border p-5 rounded-2xl space-y-3 shadow-xs text-left" style={{ textAlign: isRTL ? "right" : "left" }}>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 select-text">
              <div className="space-y-0.5">
                <div className="text-xs font-black text-foreground">
                  {isRTL ? "د. وليد غريب أبو مندور" : "Dr. Waleed Mandour"}
                </div>
                <div className="text-[10.5px] text-muted-foreground flex items-center gap-1">
                  <span>{isRTL ? "أستاذ مساعد، جامعة السلطان قابوس، سلطنة عمان" : "Assistant Professor, Sultan Qaboos University, Oman"}</span>
                  <span className="text-primary font-bold">•</span>
                  <span>2026</span>
                </div>
              </div>

              <a
                href="mailto:w.abumandour@squ.edu.om"
                className="flex items-center gap-1.5 text-[10px] uppercase font-bold text-primary hover:underline border border-primary/20 hover:border-primary/40 px-3 py-1.5 rounded-xl dark:bg-white/5 bg-background transition-all shrink-0 cursor-pointer self-start md:self-auto"
              >
                <Mail className="w-3.5 h-3.5" />
                <span>Email Creator</span>
              </a>
            </div>

            <div className="pt-3 border-t dark:border-white/5 border-border flex flex-col md:flex-row items-start md:items-center justify-between gap-3 select-text">
              <div className="space-y-0.5">
                <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                  {isRTL ? "مستودع الكود والمجتمع الأكاديمي" : "Academic Code Core & Repository"}
                </div>
                <div className="text-[10.5px] text-muted-foreground break-all font-mono text-[10px]">
                  https://github.com/waleedmandour/rdat-copilot
                </div>
              </div>

              <a
                href="https://github.com/waleedmandour/rdat-copilot"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-[10px] uppercase font-bold text-white bg-foreground dark:bg-slate-800 hover:bg-slate-700 dark:hover:bg-slate-755 px-3.5 py-1.5 rounded-xl transition-all shadow-md cursor-pointer shrink-0"
              >
                <Github className="w-3.5 h-3.5" />
                <span>Visit Repository</span>
              </a>
            </div>

            {/* MIT License collapsible terms specification */}
            <div className="pt-3 border-t dark:border-white/5 border-border space-y-2 select-text">
              <details className="group">
                <summary className="text-[10px] uppercase font-bold text-slate-500 tracking-wider flex items-center justify-between cursor-pointer list-none select-none hover:text-foreground">
                  <span>{isRTL ? "مرجع رخصة البرمجيات المفتوحة (MIT)" : "MIT License (Developer Terms)"}</span>
                  <span className="text-[9px] group-open:rotate-180 transition-transform font-mono text-primary">▼</span>
                </summary>
                <div className="mt-2.5 p-3.5 rounded-xl bg-black/5 dark:bg-black/35 border dark:border-white/5 border-border font-mono text-[9px] text-muted-foreground leading-relaxed whitespace-pre-line text-left overflow-y-auto max-h-40 scrollbar-thin">
                  {`MIT License

Copyright (c) 2026 Dr. Waleed Mandour

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`}
                </div>
              </details>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
export default WelcomeTab;
