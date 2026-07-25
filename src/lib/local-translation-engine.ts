import type { TranslationDirection } from "../stores/workspace-store";

export interface CorpusEntry {
  en: string;
  ar: string;
  type: string;
}

export interface LTEResult {
  match: string;
  source: string;
  remainder: string;
  score: number;
  type: "exact" | "partial" | "ngram" | "sentence-split";
}

// ─── Direction-aware field selection ──────────────────────────────
// In "en-ar" mode the source field is `en` and the target field is `ar`.
// In "ar-en" mode the source field is `ar` and the target field is `en`.
// All match/lookup logic in the engine operates on (sourceField, targetField)
// so it works identically in either direction.

type SourceField = "en" | "ar";
type TargetField = "en" | "ar";

function fieldsForDirection(direction: TranslationDirection): { source: SourceField; target: TargetField } {
  return direction === "ar-en"
    ? { source: "ar", target: "en" }
    : { source: "en", target: "ar" };
}

// ─── Sentence splitting ───────────────────────────────────────────
// Splits on . ! ? (Latin) AND ؟ (U+061F, Arabic question mark),
// followed by whitespace. The next-token lookahead accepts both Latin
// capital letters / quotes (for English) AND Arabic letters / quotes
// (for Arabic), so multi-sentence Arabic input is split correctly.

function splitSentences(text: string): string[] {
  const sentences = text
    .split(/(?<=[\.!\?\u061F])\s+(?=[A-Z"'\u0621-\u064A\u0660-\u066D])/u)
    .map(s => s.trim())
    .filter(s => s.length > 0);
  return sentences;
}

// ─── Normalisation ────────────────────────────────────────────────
// Lowercases, collapses whitespace, and strips trailing sentence
// terminators and Arabic punctuation that should not affect matching:
//   . ! ?                  — Latin terminators
//   ؟ (U+061F)             — Arabic question mark
//   ؛ (U+061B)             — Arabic semicolon
//   ، (U+060C)             — Arabic comma
//
// NOTE: We do NOT strip Arabic letters or normalise alef/yaa/taa marbuta
// here — that would be a deeper orthographic normalisation. We only
// strip terminators so that "Hello." and "Hello" match each other, and
// so that Arabic "كيف حالك؟" and "كيف حالك" match.

function normalize(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[\.!?\u061F\u061B\u060C]+/g, "")
    .trim();
}

function ngramSimilarity(a: string, b: string): number {
  const getTrigrams = (s: string): Set<string> => {
    const trigrams = new Set<string>();
    for (let i = 0; i < s.length - 2; i++) {
      trigrams.add(s.substring(i, i + 3));
    }
    return trigrams;
  };

  const trigramsA = getTrigrams(a);
  const trigramsB = getTrigrams(b);

  if (trigramsA.size === 0 || trigramsB.size === 0) return 0;

  let intersection = 0;
  for (const t of trigramsA) {
    if (trigramsB.has(t)) intersection++;
  }

  const union = trigramsA.size + trigramsB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

export class LocalTranslationEngine {
  private corpus: CorpusEntry[] = [];
  // Two indexes — keyed on normalised source text in each direction.
  // enIndex: normalised entry.en  -> CorpusEntry  (used when source is English, direction "en-ar")
  // arIndex: normalised entry.ar  -> CorpusEntry  (used when source is Arabic, direction "ar-en")
  private enIndex: Map<string, CorpusEntry> = new Map();
  private arIndex: Map<string, CorpusEntry> = new Map();

  load(entries: CorpusEntry[]) {
    this.corpus = entries;
    this.enIndex.clear();
    this.arIndex.clear();
    for (const entry of entries) {
      const enKey = normalize(entry.en);
      const arKey = normalize(entry.ar);
      if (enKey) this.enIndex.set(enKey, entry);
      if (arKey) this.arIndex.set(arKey, entry);
    }
    console.log(
      `[LTE] Loaded ${entries.length} corpus entries into memory (en-index: ${this.enIndex.size}, ar-index: ${this.arIndex.size}).`
    );
  }

  /**
   * Return the index keyed on the *source* field for the given direction.
   * In "en-ar" the source is English → use enIndex.
   * In "ar-en" the source is Arabic → use arIndex.
   */
  private indexForDirection(direction: TranslationDirection): Map<string, CorpusEntry> {
    return direction === "ar-en" ? this.arIndex : this.enIndex;
  }

  getSuggestion(
    sourceText: string,
    targetPrefix: string,
    direction: TranslationDirection = "en-ar"
  ): LTEResult | null {
    if (!sourceText.trim()) return null;

    const normalizedSource = normalize(sourceText);
    const index = this.indexForDirection(direction);
    const { source: sourceField, target: targetField } = fieldsForDirection(direction);

    // Step 0: Sentence splitting
    const sentences = splitSentences(sourceText);
    if (sentences.length > 1) {
      const multiResult = this.getMultiSentenceSuggestion(sentences, targetPrefix, direction);
      if (multiResult) return multiResult;
    }

    // Step 1: Exact match
    const exactMatch = index.get(normalizedSource);
    if (exactMatch) {
      const result = this.computeRemainder(
        exactMatch[sourceField],
        exactMatch[targetField],
        targetPrefix,
        "exact",
        1.0
      );
      if (result) return result;
    }

    // Step 2: Partial/prefix match
    let bestPartial: { entry: CorpusEntry; score: number } | null = null;
    for (const [key, entry] of index) {
      if (key.includes(normalizedSource) || normalizedSource.includes(key)) {
        const score = key.length / Math.max(key.length, normalizedSource.length);
        if (!bestPartial || score > bestPartial.score) {
          bestPartial = { entry, score: score * 0.85 };
        }
      }
    }

    if (bestPartial && bestPartial.score > 0.4) {
      const result = this.computeRemainder(
        bestPartial.entry[sourceField],
        bestPartial.entry[targetField],
        targetPrefix,
        "partial",
        bestPartial.score
      );
      if (result) return result;
    }

    // Step 3: N-gram similarity fallback
    // Compare the normalised source against the normalised *source* field
    // of every entry — never against the target field. This is the bug
    // that previously made AR→EN n-gram fallback compare Arabic trigrams
    // against Latin trigrams and always miss.
    let bestNgram: { entry: CorpusEntry; score: number } | null = null;
    for (const entry of this.corpus) {
      const sim = ngramSimilarity(normalizedSource, normalize(entry[sourceField]));
      if (!bestNgram || sim > bestNgram.score) {
        bestNgram = { entry, score: sim };
      }
    }

    if (bestNgram && bestNgram.score > 0.25) {
      const result = this.computeRemainder(
        bestNgram.entry[sourceField],
        bestNgram.entry[targetField],
        targetPrefix,
        "ngram",
        bestNgram.score
      );
      if (result) return result;
    }

    return null;
  }

  private getMultiSentenceSuggestion(
    sentences: string[],
    targetPrefix: string,
    direction: TranslationDirection
  ): LTEResult | null {
    const targetParts: string[] = [];
    let totalScore = 0;
    let matchedCount = 0;
    const matchedSources: string[] = [];

    for (const sentence of sentences) {
      const result = this.findBestSentenceMatch(sentence, targetPrefix, direction);
      if (result) {
        targetParts.push(result.match);
        totalScore += result.score;
        matchedCount++;
        matchedSources.push(result.source);
      }
    }

    if (matchedCount === 0) return null;

    const avgScore = totalScore / sentences.length;
    const fullTarget = targetParts.join(" ");
    const fullSource = matchedSources.join(" ");

    return this.computeRemainder(
      fullSource,
      fullTarget,
      targetPrefix,
      "sentence-split",
      avgScore
    );
  }

  private findBestSentenceMatch(
    sentence: string,
    targetPrefix: string,
    direction: TranslationDirection
  ): LTEResult | null {
    const normalizedSource = normalize(sentence);
    const index = this.indexForDirection(direction);
    const { source: sourceField, target: targetField } = fieldsForDirection(direction);

    const exactMatch = index.get(normalizedSource);
    if (exactMatch) {
      return this.computeRemainder(
        exactMatch[sourceField],
        exactMatch[targetField],
        targetPrefix,
        "exact",
        1.0
      );
    }

    let bestPartial: { entry: CorpusEntry; score: number } | null = null;
    for (const [key, entry] of index) {
      if (key.includes(normalizedSource) || normalizedSource.includes(key)) {
        const score = key.length / Math.max(key.length, normalizedSource.length);
        if (!bestPartial || score > bestPartial.score) {
          bestPartial = { entry, score: score * 0.85 };
        }
      }
    }
    if (bestPartial && bestPartial.score > 0.4) {
      return this.computeRemainder(
        bestPartial.entry[sourceField],
        bestPartial.entry[targetField],
        targetPrefix,
        "partial",
        bestPartial.score
      );
    }

    let bestNgram: { entry: CorpusEntry; score: number } | null = null;
    for (const entry of this.corpus) {
      const sim = ngramSimilarity(normalizedSource, normalize(entry[sourceField]));
      if (!bestNgram || sim > bestNgram.score) {
        bestNgram = { entry, score: sim };
      }
    }
    if (bestNgram && bestNgram.score > 0.25) {
      return this.computeRemainder(
        bestNgram.entry[sourceField],
        bestNgram.entry[targetField],
        targetPrefix,
        "ngram",
        bestNgram.score
      );
    }

    return null;
  }

  private computeRemainder(
    source: string,
    fullTarget: string,
    targetPrefix: string,
    matchType: LTEResult["type"],
    baseScore: number
  ): LTEResult | null {
    const trimmedPrefix = targetPrefix.trim();
    const trimmedTarget = fullTarget.trim();

    if (!trimmedPrefix) {
      return {
        match: fullTarget,
        source,
        remainder: fullTarget,
        score: baseScore,
        type: matchType,
      };
    }

    if (trimmedTarget.startsWith(trimmedPrefix)) {
      const remainder = trimmedTarget.substring(trimmedPrefix.length).trimStart();
      if (!remainder) return null;
      return {
        match: fullTarget,
        source,
        remainder,
        score: baseScore,
        type: matchType,
      };
    }

    // Fuzzy prefix alignment
    const alignment = this.findBestAlignment(trimmedPrefix, trimmedTarget);
    if (alignment.score > 0.5) {
      const remainder = trimmedTarget.substring(alignment.targetOffset).trimStart();
      if (!remainder) return null;
      return {
        match: fullTarget,
        source,
        remainder,
        score: baseScore * alignment.score,
        type: matchType,
      };
    }

    return null;
  }

  private findBestAlignment(prefix: string, fullTarget: string): { targetOffset: number; score: number } {
    const prefixLen = prefix.length;
    const targetLen = fullTarget.length;

    let bestOffset = 0;
    let bestScore = 0;

    const maxOffset = Math.min(Math.ceil(prefixLen * 1.5), targetLen);
    const step = Math.max(1, Math.floor(prefixLen / 10));

    for (let offset = step; offset <= maxOffset; offset += step) {
      const candidate = fullTarget.substring(0, offset);
      const similarity = ngramSimilarity(normalize(prefix), normalize(candidate));

      if (similarity > bestScore) {
        bestScore = similarity;
        bestOffset = offset;
      }
    }

    return { targetOffset: bestOffset, score: bestScore };
  }

  /**
   * Search the corpus for entries whose *source* field (selected by
   * direction) matches the query. Returns the top-`limit` entries with
   * their n-gram similarity scores.
   *
   * Defaults to "en-ar" for backward compatibility — existing callers
   * that don't pass a direction continue to get English-source search.
   */
  search(
    sourceText: string,
    limit = 5,
    direction: TranslationDirection = "en-ar"
  ): Array<CorpusEntry & { score: number }> {
    const normalizedSource = normalize(sourceText);
    const { source: sourceField } = fieldsForDirection(direction);
    const scored = this.corpus.map(entry => {
      const key = normalize(entry[sourceField]);
      const similarity = ngramSimilarity(normalizedSource, key);
      return { ...entry, score: similarity };
    });

    return scored
      .filter(s => s.score > 0.1)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  getStats() {
    return {
      entries: this.corpus.length,
      indexedKeys: this.enIndex.size + this.arIndex.size,
      enKeys: this.enIndex.size,
      arKeys: this.arIndex.size,
    };
  }

  getAll(): Array<CorpusEntry & { score: number }> {
    return this.corpus.map(entry => ({
      ...entry,
      score: 1.0,
    }));
  }
}

let lteInstance: LocalTranslationEngine | null = null;

export function getLTE(): LocalTranslationEngine {
  if (!lteInstance) {
    lteInstance = new LocalTranslationEngine();
  }
  return lteInstance;
}
