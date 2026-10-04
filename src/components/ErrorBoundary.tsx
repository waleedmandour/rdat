import { Component, type ReactNode, type ErrorInfo } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional fallback renderer. If not provided, a default is used. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** Called when an error is caught — useful for logging. */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  /** A label shown in the default fallback UI to help users locate the failure. */
  label?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Top-level React Error Boundary (audit fix #10).
 *
 * Without an error boundary, any uncaught render error in any
 * component crashes the entire React tree and shows a blank screen.
 * For a translation app where users may have unsaved drafts of long
 * segments, that's a data-loss risk. This boundary catches the error
 * and shows a fallback UI with a "Reload" button instead.
 *
 * Wrap <WorkspaceShell /> in App.tsx with this boundary. For
 * per-panel isolation, wrap individual panels (TranslationWorkspace,
 * GlossaryView, AiModelsView) with their own boundaries so a crash
 * in one panel doesn't take down the others.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("[ErrorBoundary] Caught render error:", error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.reset);
      }
      return (
        <div
          className="h-full w-full flex flex-col items-center justify-center p-8 bg-background text-foreground select-text"
          dir="ltr"
        >
          <div className="max-w-md w-full text-center space-y-4">
            <div className="text-4xl">⚠️</div>
            <h2 className="text-lg font-bold">
              {this.props.label ? `${this.props.label}: ` : ""}Something went wrong
            </h2>
            <p className="text-xs text-muted-foreground leading-relaxed">
              An unexpected error occurred while rendering this part of the app.
              Your work in other panels is preserved. You can try reloading this
              view, or refresh the entire page if the problem persists.
            </p>
            <pre className="text-[10px] font-mono text-muted-foreground bg-muted/30 border border-border rounded p-3 overflow-x-auto text-left max-h-32 overflow-y-auto">
              {this.state.error.message}
              {this.state.error.stack ? `\n\n${this.state.error.stack.split("\n").slice(0, 4).join("\n")}` : ""}
            </pre>
            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                onClick={this.reset}
                className="px-4 py-2 rounded-lg bg-primary text-white text-xs font-bold hover:bg-primary/90 cursor-pointer transition-all"
              >
                Try again
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 rounded-lg border border-border bg-surface text-foreground text-xs font-bold hover:bg-surface-hover cursor-pointer transition-all"
              >
                Reload page
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
