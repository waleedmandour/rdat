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

function splitSentences(text: string): string[] {
  const sentences = text
    .split(/(?<=[\.!\?])\s+(?=[A-Z"'])/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
  return sentences;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[\.!?\u061B\u060C]+/g, "")
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
  private normalizedIndex: Map<string, CorpusEntry> = new Map();

  load(entries: CorpusEntry[]) {
    this.corpus = entries;
    this.normalizedIndex.clear();
    for (const entry of entries) {
      const key = normalize(entry.en);
      this.normalizedIndex.set(key, entry);
    }
    console.log(`[LTE] Loaded ${entries.length} corpus entries into memory.`);
  }

  getSuggestion(sourceText: string, targetPrefix: string): LTEResult | null {
    if (!sourceText.trim()) return null;

    const normalizedSource = normalize(sourceText);

    // Step 0: Sentence splitting
    const sentences = splitSentences(sourceText);
    if (sentences.length > 1) {
      const multiResult = this.getMultiSentenceSuggestion(sentences, targetPrefix);
      if (multiResult) return multiResult;
    }

    // Step 1: Exact match
    const exactMatch = this.normalizedIndex.get(normalizedSource);
    if (exactMatch) {
      const result = this.computeRemainder(
        exactMatch.en,
        exactMatch.ar,
        targetPrefix,
        "exact",
        1.0
      );
      if (result) return result;
    }

    // Step 2: Partial/prefix match
    let bestPartial: { entry: CorpusEntry; score: number } | null = null;
    for (const [key, entry] of this.normalizedIndex) {
      if (key.includes(normalizedSource) || normalizedSource.includes(key)) {
        const score = key.length / Math.max(key.length, normalizedSource.length);
        if (!bestPartial || score > bestPartial.score) {
          bestPartial = { entry, score: score * 0.85 };
        }
      }
    }

    if (bestPartial && bestPartial.score > 0.4) {
      const result = this.computeRemainder(
        bestPartial.entry.en,
        bestPartial.entry.ar,
        targetPrefix,
        "partial",
        bestPartial.score
      );
      if (result) return result;
    }

    // Step 3: N-gram similarity fallback
    let bestNgram: { entry: CorpusEntry; score: number } | null = null;
    for (const entry of this.corpus) {
      const sim = ngramSimilarity(normalizedSource, normalize(entry.en));
      if (!bestNgram || sim > bestNgram.score) {
        bestNgram = { entry, score: sim };
      }
    }

    if (bestNgram && bestNgram.score > 0.25) {
      const result = this.computeRemainder(
        bestNgram.entry.en,
        bestNgram.entry.ar,
        targetPrefix,
        "ngram",
        bestNgram.score
      );
      if (result) return result;
    }

    return null;
  }

  private getMultiSentenceSuggestion(sentences: string[], targetPrefix: string): LTEResult | null {
    const arabicParts: string[] = [];
    let totalScore = 0;
    let matchedCount = 0;
    const matchedSources: string[] = [];

    for (const sentence of sentences) {
      const result = this.findBestSentenceMatch(sentence, targetPrefix);
      if (result) {
        arabicParts.push(result.match);
        totalScore += result.score;
        matchedCount++;
        matchedSources.push(result.source);
      }
    }

    if (matchedCount === 0) return null;

    const avgScore = totalScore / sentences.length;
    const fullArabic = arabicParts.join(" ");
    const fullSource = matchedSources.join(" ");

    return this.computeRemainder(
      fullSource,
      fullArabic,
      targetPrefix,
      "sentence-split",
      avgScore
    );
  }

  private findBestSentenceMatch(sentence: string, targetPrefix: string): LTEResult | null {
    const normalizedSource = normalize(sentence);

    const exactMatch = this.normalizedIndex.get(normalizedSource);
    if (exactMatch) {
      return this.computeRemainder(exactMatch.en, exactMatch.ar, targetPrefix, "exact", 1.0);
    }

    let bestPartial: { entry: CorpusEntry; score: number } | null = null;
    for (const [key, entry] of this.normalizedIndex) {
      if (key.includes(normalizedSource) || normalizedSource.includes(key)) {
        const score = key.length / Math.max(key.length, normalizedSource.length);
        if (!bestPartial || score > bestPartial.score) {
          bestPartial = { entry, score: score * 0.85 };
        }
      }
    }
    if (bestPartial && bestPartial.score > 0.4) {
      return this.computeRemainder(
        bestPartial.entry.en,
        bestPartial.entry.ar,
        targetPrefix,
        "partial",
        bestPartial.score
      );
    }

    let bestNgram: { entry: CorpusEntry; score: number } | null = null;
    for (const entry of this.corpus) {
      const sim = ngramSimilarity(normalizedSource, normalize(entry.en));
      if (!bestNgram || sim > bestNgram.score) {
        bestNgram = { entry, score: sim };
      }
    }
    if (bestNgram && bestNgram.score > 0.25) {
      return this.computeRemainder(
        bestNgram.entry.en,
        bestNgram.entry.ar,
        targetPrefix,
        "ngram",
        bestNgram.score
      );
    }

    return null;
  }

  private computeRemainder(
    source: string,
    fullArabic: string,
    targetPrefix: string,
    matchType: LTEResult["type"],
    baseScore: number
  ): LTEResult | null {
    const trimmedPrefix = targetPrefix.trim();
    const trimmedArabic = fullArabic.trim();

    if (!trimmedPrefix) {
      return {
        match: fullArabic,
        source,
        remainder: fullArabic,
        score: baseScore,
        type: matchType,
      };
    }

    if (trimmedArabic.startsWith(trimmedPrefix)) {
      const remainder = trimmedArabic.substring(trimmedPrefix.length).trimStart();
      if (!remainder) return null;
      return {
        match: fullArabic,
        source,
        remainder,
        score: baseScore,
        type: matchType,
      };
    }

    // Fuzzy prefix alignment
    const alignment = this.findBestAlignment(trimmedPrefix, trimmedArabic);
    if (alignment.score > 0.5) {
      const remainder = trimmedArabic.substring(alignment.arabicOffset).trimStart();
      if (!remainder) return null;
      return {
        match: fullArabic,
        source,
        remainder,
        score: baseScore * alignment.score,
        type: matchType,
      };
    }

    return null;
  }

  private findBestAlignment(prefix: string, fullArabic: string): { arabicOffset: number; score: number } {
    const prefixLen = prefix.length;
    const arabicLen = fullArabic.length;

    let bestOffset = 0;
    let bestScore = 0;

    const maxOffset = Math.min(Math.ceil(prefixLen * 1.5), arabicLen);
    const step = Math.max(1, Math.floor(prefixLen / 10));

    for (let offset = step; offset <= maxOffset; offset += step) {
      const candidate = fullArabic.substring(0, offset);
      const similarity = ngramSimilarity(normalize(prefix), normalize(candidate));

      if (similarity > bestScore) {
        bestScore = similarity;
        bestOffset = offset;
      }
    }

    return { arabicOffset: bestOffset, score: bestScore };
  }

  search(sourceText: string, limit = 5): Array<CorpusEntry & { score: number }> {
    const normalizedSource = normalize(sourceText);
    const scored = this.corpus.map(entry => {
      const key = normalize(entry.en);
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
      indexedKeys: this.normalizedIndex.size,
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
