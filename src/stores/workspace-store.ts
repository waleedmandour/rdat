import { create } from "zustand";
import type { Granularity, ManualOverride } from "../lib/segmentation";

export type TranslationDirection = "en-ar" | "ar-en";

interface WorkspaceState {
  sourceText: string;
  targetTexts: string[];
  currentSegmentIndex: number;
  highlightedSegmentIndex: number | null;
  direction: TranslationDirection;
  /** Sentence (default) or Paragraph granularity. */
  granularity: Granularity;
  /** Manual split overrides on top of automatic segmentation. */
  manualBreaks: ManualOverride[];
  /** Manual join overrides (global segment indices). */
  manualJoins: number[];
  setSourceText: (text: string) => void;
  setTargetTexts: (textsOrUpdater: string[] | ((prev: string[]) => string[])) => void;
  setTargetTextAtIndex: (index: number, text: string) => void;
  setCurrentSegmentIndex: (index: number) => void;
  setHighlightedSegmentIndex: (index: number | null) => void;
  setDirection: (direction: TranslationDirection) => void;
  setGranularity: (granularity: Granularity) => void;
  addManualBreak: (segmentIndex: number, offset: number) => void;
  addManualJoin: (segmentIndex: number) => void;
  /** Clear all manual overrides (called when source text changes). */
  clearManualOverrides: () => void;
}

const DEFAULT_SOURCE = "";

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  sourceText: DEFAULT_SOURCE,
  targetTexts: [],
  currentSegmentIndex: 0,
  highlightedSegmentIndex: null,
  direction: "en-ar",
  granularity: "sentence",
  manualBreaks: [],
  manualJoins: [],

  setSourceText: (sourceText) => set({ sourceText, manualBreaks: [], manualJoins: [], currentSegmentIndex: 0 }),
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
  setDirection: (direction) => set({ direction, manualBreaks: [], manualJoins: [], currentSegmentIndex: 0 }),
  setGranularity: (granularity) => set({ granularity }),
  addManualBreak: (segmentIndex, offset) => set((state) => ({
    manualBreaks: [...state.manualBreaks, { segmentIndex, offset }],
  })),
  addManualJoin: (segmentIndex) => set((state) => ({
    manualJoins: [...state.manualJoins, segmentIndex],
  })),
  clearManualOverrides: () => set({ manualBreaks: [], manualJoins: [] }),
}));
export default useWorkspaceStore;
