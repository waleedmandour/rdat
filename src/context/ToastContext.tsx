import React, { createContext, useContext, useState, useCallback } from "react";
import { Toast, ToastType, ToastContextType } from "../types";
import { AnimatePresence, motion } from "motion/react";
import { X, CheckCircle2, AlertCircle, Info, HelpCircle } from "lucide-react";

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback((message: string, type: ToastType = "info") => {
    const id = Date.now().toString() + Math.random().toString(36).substr(2, 5);
    setToasts((prev) => [...prev, { id, message, type }]);

    // Auto remove after 4 seconds
    setTimeout(() => {
      removeToast(id);
    }, 4000);
  }, [removeToast]);

  return (
    <ToastContext.Provider value={{ toasts, showToast, removeToast }}>
      {children}

      {/* Floating Toasts container */}
      <div className="fixed bottom-16 right-6 z-50 flex flex-col gap-2 max-w-sm pointer-events-none select-none">
        <AnimatePresence>
          {toasts.map((toast) => {
            let icon = <Info className="w-4 h-4 text-primary" />;
            let borderClass = "border-primary/20 dark:bg-[#14161b] bg-background/95 text-foreground";
            
            if (toast.type === "success") {
              icon = <CheckCircle2 className="w-4 h-4 text-emerald-400 dark:text-emerald-400" />;
              borderClass = "border-emerald-500/20 dark:bg-emerald-950/40 bg-emerald-50 text-foreground";
            } else if (toast.type === "error") {
              icon = <AlertCircle className="w-4 h-4 text-rose-400 dark:text-rose-400" />;
              borderClass = "border-rose-500/20 dark:bg-rose-950/40 bg-rose-50 text-foreground";
            } else if (toast.type === "warning") {
              icon = <AlertCircle className="w-4 h-4 text-amber-400 dark:text-amber-400" />;
              borderClass = "border-amber-500/20 dark:bg-amber-950/40 bg-amber-50 text-foreground";
            }

            return (
              <motion.div
                key={toast.id}
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95, transition: { duration: 0.15 } }}
                className={`pointer-events-auto flex items-start gap-3 p-4 rounded-xl border backdrop-blur-md shadow-lg transition-all ${borderClass}`}
              >
                <div className="mt-0.5 shrink-0">{icon}</div>
                <div className="flex-1 text-xs font-semibold leading-relaxed pr-2">
                  {toast.message}
                </div>
                <button
                  onClick={() => removeToast(toast.id)}
                  className="shrink-0 p-0.5 hover:bg-white/10 rounded transition-colors text-muted-foreground hover:text-foreground cursor-pointer"
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
