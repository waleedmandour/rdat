import { create } from "zustand";

interface WorkspaceState {
  sourceText: string;
  targetTexts: string[];
  currentSegmentIndex: number;
  highlightedSegmentIndex: number | null;
  setSourceText: (text: string) => void;
  setTargetTexts: (texts: string[]) => void;
  setTargetTextAtIndex: (index: number, text: string) => void;
  setCurrentSegmentIndex: (index: number) => void;
  setHighlightedSegmentIndex: (index: number | null) => void;
}

const DEFAULT_SOURCE = 
`Computer-assisted translation (CAT), also known as computer-aided translation, is a form of language translation in which a human translator uses computer software to support and facilitate the translation process.

Neural machine translation (NMT) is an approach to machine translation that uses a large artificial neural network to predict the likelihood of a sequence of words, typically modeling entire sentences in a single integrated model.

At the heart of the system is the translation memory (TM). A translation memory is a database that stores segments of text that have been previously translated.

Local language models on device ensure data privacy and provide fast offline terminology matching. These systems optimize student workflow efficiency.`;

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  sourceText: DEFAULT_SOURCE,
  targetTexts: Array(10).fill(""),
  currentSegmentIndex: 0,
  highlightedSegmentIndex: null,

  setSourceText: (sourceText) => set({ sourceText }),
  setTargetTexts: (targetTexts) => set({ targetTexts }),
  setTargetTextAtIndex: (index, text) => set((state) => {
    const updated = [...state.targetTexts];
    updated[index] = text;
    return { targetTexts: updated };
  }),
  setCurrentSegmentIndex: (currentSegmentIndex) => set({ currentSegmentIndex }),
  setHighlightedSegmentIndex: (highlightedSegmentIndex) => set({ highlightedSegmentIndex }),
}));
export default useWorkspaceStore;
