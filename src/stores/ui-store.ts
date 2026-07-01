import { create } from "zustand";
import { NavItem } from "../types";

/**
 * UI Store — cross-component UI state.
 *
 * Currently used to let deeply-nested components (e.g. the inline
 * "Load Local Model" hint inside TargetEditor) request that
 * WorkspaceShell switch to a different nav panel. Without this,
 * the panel-switching state lives only in WorkspaceShell's useState
 * and is unreachable from leaf components.
 *
 * Usage:
 *   const requestNav = useUIStore((s) => s.requestNav);
 *   requestNav("models");  // WorkspaceShell will switch panels
 */
interface UIState {
  /** The panel WorkspaceShell should switch to, or null if no request. */
  pendingNav: NavItem | null;
  /** Request a panel switch. WorkspaceShell consumes & clears this. */
  requestNav: (item: NavItem) => void;
  /** Clear the pending request (called by WorkspaceShell after switching). */
  clearPendingNav: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  pendingNav: null,
  requestNav: (item) => set({ pendingNav: item }),
  clearPendingNav: () => set({ pendingNav: null }),
}));

export default useUIStore;
