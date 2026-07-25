import React, { createContext, useContext, useState, useCallback } from "react";
import { Toast, ToastType, ToastContextType } from "../types";
import { AnimatePresence, motion } from "motion/react";
import { X, CheckCircle2, AlertCircle, Info } from "lucide-react";

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback((message: string, type: ToastType = "info") => {
    const id = Date.now().toString() + Math.random().toString(36).substr(2, 5);
    setToasts((prev) => [...prev, { id, message, type }]);

    setTimeout(() => {
      removeToast(id);
    }, 4000);
  }, [removeToast]);

  return (
    <ToastContext.Provider value={{ toasts, showToast, removeToast }}>
      {children}

      <div className="fixed bottom-16 right-6 z-50 flex flex-col gap-2 max-w-sm pointer-events-none select-none">
        <AnimatePresence>
          {toasts.map((toast) => {
            // Pick the icon + coloured left-border for each toast type.
            // The toast body itself uses theme tokens (bg-surface /
            // text-foreground) so it looks correct in both light and
            // dark mode. See PHASE 2 task 2.2.
            let icon = <Info className="w-4 h-4 text-blue-400" />;
            let borderColor = "border-l-blue-500";

            if (toast.type === "success") {
              icon = <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
              borderColor = "border-l-emerald-500";
            } else if (toast.type === "error") {
              icon = <AlertCircle className="w-4 h-4 text-rose-400" />;
              borderColor = "border-l-rose-500";
            } else if (toast.type === "warning") {
              icon = <AlertCircle className="w-4 h-4 text-amber-400" />;
              borderColor = "border-l-amber-500";
            }

            return (
              <motion.div
                key={toast.id}
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95, transition: { duration: 0.15 } }}
                // Theme-aware toast background. Previously this was a
                // hardcoded bg-[#1a1d23] + text-white that stayed dark
                // even in light mode, which clashed with the rest of
                // the app. Switched to bg-surface / text-foreground so
                // toasts follow the active theme. The coloured left
                // border still distinguishes the toast type. If you
                // want the always-dark look back, revert to:
                //   bg-[#1a1d23] text-white border-white/10
                // See PHASE 2 task 2.2.
                className={`pointer-events-auto flex items-start gap-3 p-4 rounded-xl border border-border border-l-4 ${borderColor} bg-surface text-foreground shadow-lg backdrop-blur-md`}
              >
                <div className="mt-0.5 shrink-0">{icon}</div>
                <div className="flex-1 text-xs font-semibold leading-relaxed pr-2">
                  {toast.message}
                </div>
                <button
                  onClick={() => removeToast(toast.id)}
                  className="shrink-0 p-0.5 hover:bg-muted rounded transition-colors text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
