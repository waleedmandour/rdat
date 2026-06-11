import React, { useState, useEffect } from "react";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { NavItem, EngineMode, GTRStatus, WebGPUInfo, RAGState, LocalAgentState } from "../types";
import { useDualStorage } from "../hooks/useDualStorage";
import { WelcomeTab } from "./WelcomeTab";
import { TranslationWorkspace } from "./editors/TranslationWorkspace";
import { SettingsPanel } from "./Settings";
import { AiModelsView } from "./AiModelsView";
import { ApiKeysView } from "./ApiKeysView";
import { GlossaryView } from "./GlossaryView";
import { QuickGuideModal } from "./QuickGuideModal";
import { InstallPWAButton } from "./InstallPWAButton";
import { useLanguage } from "../context/LanguageContext";
import { useToast } from "../context/ToastContext";
import { useSettingsStore } from "../stores/settings-store";
import { useRAG } from "../hooks/useRAG";
import { useLocalAgent } from "../hooks/useLocalAgent";
import { useWebLLM } from "../hooks/useWebLLM";
import { Sun, Moon, HelpCircle, RefreshCw } from "lucide-react";
import { cn } from "../lib/utils";

export function WorkspaceShell() {
  const { t, locale } = useLanguage();
  const { showToast } = useToast();
  
  // Theme state
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("rdat_theme");
      if (stored === "light" || stored === "dark") return stored as "light" | "dark";
    }
    return "dark"; // Default to high-contrast dark theme
  });

  useEffect(() => {
    localStorage.setItem("rdat_theme", theme);
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [theme]);

  const [activeNav, setActiveNav] = useState<NavItem | "welcome">("welcome");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  // Grab custom stores & hooks
  const { engineMode, geminiApiKey, useGtr } = useSettingsStore();
  const { ragState } = useRAG();
  const { localAgentState } = useLocalAgent();
  const { webgpuInfo } = useWebLLM();
  const storage = useDualStorage();

  const handleStartEditing = () => {
    setActiveNav("translator");
  };

  const navTitleMap: Record<NavItem | "welcome", string> = {
    welcome: locale === "en" ? "Dashboard" : "الرئيسية",
    translator: t("workspace.title.translator"),
    glossary: t("workspace.title.glossary"),
    models: t("workspace.title.models"),
    "api-keys": t("workspace.title.apiKeys"),
    settings: t("workspace.title.settings"),
  };

  // Render individual panels reactively
  const renderView = () => {
    switch (activeNav) {
      case "translator":
        return <TranslationWorkspace />;
      case "glossary":
        return <GlossaryView />;
      case "models":
        return <AiModelsView />;
      case "api-keys":
        return <ApiKeysView />;
      case "settings":
        return <SettingsPanel />;
      default:
        return <WelcomeTab onStart={handleStartEditing} />;
    }
  };

  return (
    <div className={cn(
      "flex flex-col h-screen w-screen overflow-hidden bg-background text-foreground",
      theme === "dark" ? "dark" : ""
    )}
    dir={locale === "ar" ? "rtl" : "ltr"}
    >
      <InstallPWAButton />

      {/* Main Container */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* Navigation Sidebar */}
        <Sidebar
          activeItem={activeNav === "welcome" ? ("translator" as any) : activeNav}
          onNavItemChange={(item) => setActiveNav(item)}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed(!sidebarCollapsed)}
          onOpenGuide={() => setShowGuide(true)}
        />

        {/* Content Workspace */}
        <main className="flex-1 flex flex-col overflow-hidden">
          
          {/* Top Header Controls Bar */}
          <header className="h-14 bg-surface border-b border-border flex items-center justify-between px-4 select-none">
            
            {/* Header Title */}
            <div className="flex items-center gap-3">
              {activeNav !== "welcome" && (
                <button
                  onClick={() => setActiveNav("welcome")}
                  className="text-[10.5px] font-bold text-primary hover:underline cursor-pointer"
                >
                  {locale === "en" ? "← Back to Dashboard" : "← الرئيسية"}
                </button>
              )}
              <h1 className="text-sm font-black text-foreground">
                {navTitleMap[activeNav]}
              </h1>
            </div>

            {/* Header Right Utilities */}
            <div className="flex items-center gap-2">
              
              {/* Sync terminology with backend for true offline syncing */}
              <button
                onClick={async () => {
                  const done = await storage.syncOfflineTerminology();
                  if (done) {
                    showToast(
                      locale === "en" ? "Offline terminology synced successfully!" : "تمت مزامنة المصطلحات بنجاح!",
                      "success"
                    );
                  } else if (!storage.isBackendReachable) {
                    showToast(
                      locale === "en" ? "Sync queued! App is offline and will retry when network returns." : "تعذر الاتصال! سيتم إعادة المحاولة تلقائياً عند عودة الاتصال.",
                      "warning"
                    );
                  }
                }}
                disabled={storage.isSyncing}
                className="p-1.5 rounded-lg border border-border bg-background hover:bg-surface-hover text-muted-foreground hover:text-foreground cursor-pointer transition-all flex items-center gap-1.5 text-xs font-semibold"
                title={locale === "en" ? "Sync Database" : "مزامنة قاعدة البيانات"}
              >
                <RefreshCw className={cn("w-3.5 h-3.5 text-primary", storage.isSyncing && "animate-spin")} />
                {!sidebarCollapsed && <span className="text-[10px] hidden md:inline">{locale === "en" ? "Sync" : "مزامنة"}</span>}
              </button>

              {/* Theme Toggle switches light/dark mode */}
              <button
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                className="p-1.5 rounded-lg border border-border bg-background hover:bg-surface-hover text-muted-foreground hover:text-foreground cursor-pointer transition-all"
                title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
              >
                {theme === "dark" ? <Sun className="w-4 h-4 text-amber-500" /> : <Moon className="w-4 h-4 text-slate-500" />}
              </button>

              {/* Help button shows guide modal */}
              <button
                onClick={() => setShowGuide(true)}
                className="p-1.5 rounded-lg border border-border bg-background hover:bg-surface-hover text-muted-foreground hover:text-foreground cursor-pointer transition-all"
                title={locale === "en" ? "Quick Shortcuts" : "دليل المساعدة"}
              >
                <HelpCircle className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>

          </header>

          {/* Active View Container */}
          <div className="flex-1 overflow-hidden bg-background">
            {renderView()}
          </div>

        </main>

      </div>

      {/* Footer System Status Bar */}
      <StatusBar
        engineMode={engineMode}
        gtrStatus={storage.glossaryCount > 0 ? "active" : "zero-shot"}
        webgpuInfo={webgpuInfo}
        geminiAvailable={!!geminiApiKey}
        ragState={ragState}
        localAgentState={localAgentState}
        segmentCount={storage.segmentCount}
        wordCount={0}
        storageInfo={{
          tmCount: storage.tmCount,
          glossaryCount: storage.glossaryCount,
          segmentCount: storage.segmentCount,
          isSyncing: storage.isSyncing,
          isBackendReachable: storage.isBackendReachable,
          lastSyncAt: storage.lastSyncAt
        }}
      />

      {/* Interactive guide modal popup */}
      <QuickGuideModal open={showGuide} onClose={() => setShowGuide(false)} />
    </div>
  );
}
export default WorkspaceShell;
