import React, { createContext, useContext, useState, useEffect } from "react";
import { translations, Locale } from "../i18n/translations";
import { LanguageContextType } from "../types";

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState<Locale>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("rdat_locale");
      if (stored === "en" || stored === "ar") return stored as Locale;
    }
    return "en";
  });

  useEffect(() => {
    localStorage.setItem("rdat_locale", locale);
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
    document.documentElement.lang = locale;
  }, [locale]);

  const t = (path: string): any => {
    const keys = path.split(".");
    let current: any = translations[locale];

    for (const key of keys) {
      if (current === undefined || current === null) {
        return path;
      }
      current = current[key];
    }

    return current !== undefined ? current : path;
  };

  return (
    <LanguageContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return context;
}
