/**
 * Glossary adherence matcher.
 *
 * Checks whether a required Arabic target term appears in the hypothesis,
 * tolerant of the definite article ال and attached proclitics
 * (و ب ل ك ف). Also detects over-forcing (term inserted where it does
 * not apply).
 */

import { normalizeArabic } from "./normalizer";

export interface AdherenceResult {
  /** The term was found. */
  found: boolean;
  /** The term was found only with clitic/article tolerance. */
  foundWithTolerance: boolean;
  /** The term was NOT found (false positive in the glossary). */
  overForced: boolean;
}

const PROCLITICS = ["\u0648", "\u0628", "\u0644", "\u0643", "\u0641"]; // و ب ل ك ف
const ARTICLE = "\u0627\u0644"; // ال

/**
 * Check if a required Arabic target term appears in the hypothesis text.
 * Normalizes both before matching. Tolerant of the definite article ال
 * and attached proclitics (و ب ل ك ف) prepended to the term.
 *
 * @param hypothesis - the model's translation (Arabic)
 * @param requiredTerm - the required Arabic target term from the glossary
 * @returns AdherenceResult
 */
export function checkAdherence(hypothesis: string, requiredTerm: string): AdherenceResult {
  const normHyp = normalizeArabic(hypothesis);
  const normTerm = normalizeArabic(requiredTerm);

  if (!normTerm) return { found: false, foundWithTolerance: false, overForced: false };

  // Direct match
  if (normHyp.includes(normTerm)) {
    return { found: true, foundWithTolerance: false, overForced: false };
  }

  // Try with the definite article ال prepended
  if (normHyp.includes(ARTICLE + normTerm)) {
    return { found: true, foundWithTolerance: true, overForced: false };
  }

  // Try with each proclitic prepended
  for (const clitic of PROCLITICS) {
    if (normHyp.includes(clitic + normTerm)) {
      return { found: true, foundWithTolerance: true, overForced: false };
    }
    // Also try proclitic + article + term
    if (normHyp.includes(clitic + ARTICLE + normTerm)) {
      return { found: true, foundWithTolerance: true, overForced: false };
    }
  }

  // Not found — could be over-forcing (the term was inserted in a context
  // where it doesn't apply). We can't detect over-forcing from a single
  // sentence without context, so we return found=false. The aggregator
  // can compute over-forcing by checking if the term appears in the
  // source text but NOT in the reference.
  return { found: false, foundWithTolerance: false, overForced: false };
}

/**
 * Compute glossary adherence rate over a set of sentences.
 *
 * @param translations - array of { hypothesis, reference, source, glossaryTerms }
 * @returns { adherenceRate, toleranceRate, overForcingRate }
 */
export function computeAdherenceRate(
  translations: Array<{
    hypothesis: string;
    reference: string;
    source: string;
    glossaryTerms: Array<{ source: string; target: string }>;
  }>
): { adherenceRate: number; toleranceRate: number; overForcingRate: number; totalTerms: number; foundTerms: number } {
  let totalTerms = 0;
  let foundTerms = 0;
  let toleranceFound = 0;
  let overForced = 0;

  for (const t of translations) {
    for (const term of t.glossaryTerms) {
      // Only check if the source term appears in the source text
      if (!t.source.toLowerCase().includes(term.source.toLowerCase())) continue;
      totalTerms++;
      const result = checkAdherence(t.hypothesis, term.target);
      if (result.found) {
        foundTerms++;
        if (result.foundWithTolerance) toleranceFound++;
      }
      // Over-forcing: the term appears in the hypothesis but NOT in the source
      const normHyp = normalizeArabic(t.hypothesis);
      const normTerm = normalizeArabic(term.target);
      if (normHyp.includes(normTerm) && !t.source.toLowerCase().includes(term.source.toLowerCase())) {
        overForced++;
      }
    }
  }

  return {
    adherenceRate: totalTerms > 0 ? foundTerms / totalTerms : 0,
    toleranceRate: totalTerms > 0 ? toleranceFound / totalTerms : 0,
    overForcingRate: totalTerms > 0 ? overForced / totalTerms : 0,
    totalTerms,
    foundTerms,
  };
}
