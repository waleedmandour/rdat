import { create } from "zustand";

/**
 * Editor Activity Store — tracks what the editor is currently doing
 * so the StatusBar can show "Typing", "Suggesting", "Idle", etc.
 *
 * This is a lightweight store that TargetEditor updates and StatusBar reads.
 * It's separate from the adapter state because it tracks user activity,
 * not engine state.
 */

export type EditorActivity = "idle" | "typing" | "suggesting" | "loading-model";

interface EditorActivityState {
  activity: EditorActivity;
  setActivity: (activity: EditorActivity) => void;
}

export const useEditorActivityStore = create<EditorActivityState>((set) => ({
  activity: "idle",
  setActivity: (activity) => set({ activity }),
}));

export default useEditorActivityStore;
