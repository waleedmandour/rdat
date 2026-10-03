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
  /**
   * Active document/project id (Issue 2, v0.4.1). Generated on import
   * (crypto.randomUUID()). Used in segment ids so confirming a segment
   * in document B doesn't overwrite document A's saved translation.
   * null when no document is loaded.
   */
  currentDocId: string | null;
  /** Display name of the active document (filename or "Pasted text"). */
  currentDocName: string;
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
  /** Set the active document (called on import). */
  setCurrentDoc: (id: string | null, name: string) => void;
}

const DEFAULT_SOURCE = "";

function generateDocId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // Fallback for environments without crypto.randomUUID
    return `doc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  sourceText: DEFAULT_SOURCE,
  targetTexts: [],
  currentSegmentIndex: 0,
  highlightedSegmentIndex: null,
  direction: "en-ar",
  granularity: "sentence",
  manualBreaks: [],
  manualJoins: [],
  currentDocId: null,
  currentDocName: "",

  // setSourceText is called on import. Generate a new docId + reset
  // everything. Also clears manual overrides + segment index.
  setSourceText: (sourceText) => set({
    sourceText,
    manualBreaks: [],
    manualJoins: [],
    currentSegmentIndex: 0,
    // Issue 2: generate a fresh docId on every new source text so the
    // new document's segments don't collide with a previous document's.
    currentDocId: sourceText.trim() ? generateDocId() : null,
    currentDocName: sourceText.trim() ? "Pasted text" : "",
  }),
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
  setCurrentDoc: (id, name) => set({ currentDocId: id, currentDocName: name }),
}));
export default useWorkspaceStore;
