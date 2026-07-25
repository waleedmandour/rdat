import { LanguageProvider } from "./context/LanguageContext";
import { ToastProvider } from "./context/ToastContext";
import { WorkspaceShell } from "./components/WorkspaceShell";
import { ErrorBoundary } from "./components/ErrorBoundary";

export default function App() {
  return (
    <LanguageProvider>
      <ToastProvider>
        {/* Audit fix #10: top-level error boundary catches any uncaught
            render error and shows a fallback UI instead of a blank screen.
            Per-panel boundaries inside WorkspaceShell provide finer-grained
            isolation so a crash in one panel doesn't take down the others. */}
        <ErrorBoundary label="App">
          <WorkspaceShell />
        </ErrorBoundary>
      </ToastProvider>
    </LanguageProvider>
  );
}

