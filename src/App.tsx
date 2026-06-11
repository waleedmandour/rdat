import React from "react";
import { LanguageProvider } from "./context/LanguageContext";
import { ToastProvider } from "./context/ToastContext";
import { WorkspaceShell } from "./components/WorkspaceShell";

export default function App() {
  return (
    <LanguageProvider>
      <ToastProvider>
        <WorkspaceShell />
      </ToastProvider>
    </LanguageProvider>
  );
}

