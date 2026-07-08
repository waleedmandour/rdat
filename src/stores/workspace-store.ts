import { create } from "zustand";

export type TranslationDirection = "en-ar" | "ar-en";

interface WorkspaceState {
  sourceText: string;
  targetTexts: string[];
  currentSegmentIndex: number;
  highlightedSegmentIndex: number | null;
  direction: TranslationDirection;
  setSourceText: (text: string) => void;
  setTargetTexts: (textsOrUpdater: string[] | ((prev: string[]) => string[])) => void;
  setTargetTextAtIndex: (index: number, text: string) => void;
  setCurrentSegmentIndex: (index: number) => void;
  setHighlightedSegmentIndex: (index: number | null) => void;
  setDirection: (direction: TranslationDirection) => void;
}

const DEFAULT_SOURCE = "";

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  sourceText: DEFAULT_SOURCE,
  targetTexts: [],
  currentSegmentIndex: 0,
  highlightedSegmentIndex: null,
  direction: "en-ar",

  setSourceText: (sourceText) => set({ sourceText }),
  setTargetTexts: (textsOrUpdater) => set((state) => {
    const newTargetTexts = typeof textsOrUpdater === 'function'
      ? textsOrUpdater(state.targetTexts)
      : textsOrUpdater;
    return { targetTexts: newTargetTexts };
  }),
  setTargetTextAtIndex: (index, text) => set((state) => {
    const updated = [...state.targetTexts];
    updated[index] = text;
    return { targetTexts: updated };
  }),
  setCurrentSegmentIndex: (currentSegmentIndex) => set({ currentSegmentIndex }),
  setHighlightedSegmentIndex: (highlightedSegmentIndex) => set({ highlightedSegmentIndex }),
  setDirection: (direction) => set({ direction }),
}));
export default useWorkspaceStore;
