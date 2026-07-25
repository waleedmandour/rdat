import { useState, useEffect } from "react";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { NavItem } from "../types";
import { useDualStorage } from "../hooks/useDualStorage";
import { WelcomeTab } from "./WelcomeTab";
import { TranslationWorkspace } from "./editors/TranslationWorkspace";
import { SettingsPanel } from "./Settings";
import { AiModelsView } from "./AiModelsView";
import { ApiKeysView } from "./ApiKeysView";
import { GlossaryView } from "./GlossaryView";
import { QuickGuideModal } from "./QuickGuideModal";
import { WelcomeWindow, shouldShowWelcome } from "./WelcomeWindow";
import { OllamaOnboardingModal, shouldShowOllamaOnboarding } from "./OllamaOnboardingModal";
import { InstallPWAButton } from "./InstallPWAButton";
import { ErrorBoundary } from "./ErrorBoundary";
import { useLanguage } from "../context/LanguageContext";
import { useToast } from "../context/ToastContext";
import { useSettingsStore } from "../stores/settings-store";
import { useUIStore } from "../stores/ui-store";
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
  const [showWelcome, setShowWelcome] = useState(shouldShowWelcome());

  // ─── Ollama Onboarding Modal ────────────────────────────────────
  // Shows on startup if running in Tauri AND Ollama is not detected.
  // Skippable — respects user agency. See OllamaOnboardingModal.tsx.
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingChecking, setOnboardingChecking] = useState(false);

  useEffect(() => {
    // ── Trigger adapter detection on app startup ──
    // This is CRITICAL: if we don't call getActiveAdapter() early,
    // getActiveAdapterSync() in TargetEditor returns null and no
    // suggestions are ever generated. Previously this was only called
    // when the user visited the Models panel, which meant the editor
    // had no adapter until the user navigated there manually.
    //
    // ── Auto-recovery (Task 1 fix) ──
    // The adapter factory memoizes its result — once it resolves to
    // null (all retries exhausted), subsequent getActiveAdapter() calls
    // return the cached null forever. This caused the "App Engine
    // offline" bug: if Ollama was still starting up when the factory's
    // initial retry budget ran out, the cache locked in null and the
    // user had to click "Recheck" in the Models panel to clear it.
    //
    // Fix: when the factory resolves to null, reset the cache and
    // re-attempt detection on a backoff schedule. Stop once an adapter
    // is found. This auto-recovers without user intervention. Only
    // runs in Tauri mode (PWA mode falls back to WebLLM/Gemini and
    // has no daemon to wait for).
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const detectWithAutoRecovery = async () => {
      const { getActiveAdapter, resetAdapter, isTauriEnvironment } = await import("../lib/adapters");

      // Only auto-retry in Tauri mode — PWA's WebGPU check is
      // deterministic and won't suddenly start succeeding.
      const shouldAutoRetry = isTauriEnvironment();

      let attempt = 0;
      while (!cancelled) {
        attempt++;
        const adapter = await getActiveAdapter();
        if (cancelled) return;

        if (adapter) {
          console.log(`[WorkspaceShell] Adapter detected on attempt ${attempt}:`, adapter.displayName);
          return;
        }

        if (!shouldAutoRetry) {
          console.log("[WorkspaceShell] No adapter detected (PWA mode, no auto-retry).");
          return;
        }

        // Factory resolved to null — Ollama wasn't ready. Reset the
        // cache so the next getActiveAdapter() call re-runs detection
        // from scratch instead of returning the cached null.
        resetAdapter();

        // Backoff: 10s between attempts. Long enough to give Ollama
        // time to finish autostart, short enough that the user
        // perceives recovery as automatic. Cap at 12 attempts (2 min
        // total) so we don't poll forever if Ollama truly isn't
        // installed.
        if (attempt >= 12) {
          console.warn(`[WorkspaceShell] Adapter detection gave up after ${attempt} attempts (2 min). User can still click Recheck in the Models panel.`);
          return;
        }

        console.log(`[WorkspaceShell] Adapter not detected (attempt ${attempt}). Retrying in 10s...`);
        await new Promise<void>((resolve) => {
          retryTimer = setTimeout(() => resolve(), 10000);
        });
        if (cancelled) return;
      }
    };

    detectWithAutoRecovery();

    // Check on mount whether we should show the onboarding modal
    if (shouldShowOllamaOnboarding()) {
      // Defer slightly so the app shell renders first
      const timer = setTimeout(async () => {
        const { isTauriEnvironment, OllamaAdapter } = await import("../lib/adapters");
        if (!isTauriEnvironment()) return;
        const adapter = new OllamaAdapter();
        const healthy = await adapter.isAvailable();
        if (!healthy) {
          setShowOnboarding(true);
        }
      }, 1500);
      return () => {
        cancelled = true;
        if (retryTimer) clearTimeout(retryTimer);
        clearTimeout(timer);
      };
    }
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, []);

  const handleOnboardingRetry = async (): Promise<boolean> => {
    setOnboardingChecking(true);
    try {
      const { OllamaAdapter } = await import("../lib/adapters");
      const adapter = new OllamaAdapter();
      const healthy = await adapter.isAvailable();
      return healthy;
    } catch {
      return false;
    } finally {
      setOnboardingChecking(false);
    }
  };

  // ─── Cross-component nav requests ──────────────────────────────
  // Allows deeply-nested components (e.g. the inline "Load Local Model"
  // hint inside TargetEditor) to request a panel switch.
  const pendingNav = useUIStore((s) => s.pendingNav);
  const clearPendingNav = useUIStore((s) => s.clearPendingNav);
  useEffect(() => {
    if (pendingNav) {
      setActiveNav(pendingNav);
      clearPendingNav();
    }
  }, [pendingNav, clearPendingNav]);

  // Grab custom stores & hooks
  const { engineMode } = useSettingsStore();
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

  // Render individual panels reactively.
  // Audit fix #10: each panel is wrapped in its own ErrorBoundary so
  // a render crash in one panel (e.g. a malformed glossary entry that
  // breaks GlossaryView) doesn't take down the rest of the app. The
  // user can navigate away and back, or click "Try again" in the
  // fallback UI to reset the boundary state.
  const renderView = () => {
    switch (activeNav) {
      case "translator":
        return (
          <ErrorBoundary label="Translator">
            <TranslationWorkspace />
          </ErrorBoundary>
        );
      case "glossary":
        return (
          <ErrorBoundary label="Glossary">
            <GlossaryView />
          </ErrorBoundary>
        );
      case "models":
        return (
          <ErrorBoundary label="Models">
            <AiModelsView />
          </ErrorBoundary>
        );
      case "api-keys":
        return (
          <ErrorBoundary label="API Keys">
            <ApiKeysView />
          </ErrorBoundary>
        );
      case "settings":
        return (
          <ErrorBoundary label="Settings">
            <SettingsPanel />
          </ErrorBoundary>
        );
      default:
        return (
          <ErrorBoundary label="Dashboard">
            <WelcomeTab onStart={handleStartEditing} />
          </ErrorBoundary>
        );
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
        webgpuInfo={webgpuInfo}
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

      {/* Ollama onboarding modal (Tauri only, first run) */}
      <OllamaOnboardingModal
        open={showOnboarding}
        onClose={() => setShowOnboarding(false)}
        onRetry={handleOnboardingRetry}
        isChecking={onboardingChecking}
      />

      {/* Welcome window (3-page onboarding, first run only) */}
      {showWelcome && (
        <WelcomeWindow onComplete={() => setShowWelcome(false)} />
      )}
    </div>
  );
}
export default WorkspaceShell;
