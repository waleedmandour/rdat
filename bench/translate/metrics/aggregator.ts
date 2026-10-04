/**
 * Aggregator: combines chrF, BLEU, compliance, adherence, and timing
 * results into a per-model summary.
 */

export interface ModelSummary {
  modelRef: string;
  family: string;
  condition: string;
  direction: string;
  dataset: string;
  // Quality
  chrfPlusPlus: number | null;
  chrfPlusPlusCI: [number, number] | null;
  bleu: number | null;
  chrfNormalized: number | null;
  comet: number | null;
  // Compliance
  emptyRate: number;
  preambleRate: number;
  markdownFenceRate: number;
  thinkingTagRate: number;
  wrongScriptRate: number;
  repetitionRate: number;
  lengthRatioOutOfRangeRate: number;
  truncationRate: number;
  // Glossary adherence
  adherenceRate: number;
  toleranceRate: number;
  overForcingRate: number;
  // Performance (latency subset only)
  ttftP50Ms: number | null;
  ttftP95Ms: number | null;
  decodeSpeedTokensPerSec: number | null;
  decodeSpeedCharsPerSec: number | null;
  endToEndMsPerSegment: number | null;
  coldLoadMs: number | null;
  loadDurationMs: number | null;
  promptEvalDurationMs: number | null;
  evalDurationMs: number | null;
  sizeVramMb: number | null;
  sizeMb: number | null;
  partiallyOffloaded: boolean;
  // Licence
  licence: string;
  licenceNote: string;
  // Metadata
  segmentsEvaluated: number;
}

/**
 * Aggregate raw results into a model summary.
 * This is a pure function — all the actual scoring (chrF, COMET) is
 * done by the Python scorer separately. This function combines the
 * pre-computed scores with the compliance + timing data.
 */
export function aggregateModelSummary(
  modelRef: string,
  family: string,
  condition: string,
  direction: string,
  dataset: string,
  licence: string,
  licenceNote: string,
  qualityScores: {
    chrfPlusPlus?: number;
    chrfPlusPlusCI?: [number, number];
    bleu?: number;
    chrfNormalized?: number;
    comet?: number;
  },
  complianceRates: {
    emptyRate: number;
    preambleRate: number;
    markdownFenceRate: number;
    thinkingTagRate: number;
    wrongScriptRate: number;
    repetitionRate: number;
    lengthRatioOutOfRangeRate: number;
    truncationRate: number;
  },
  adherenceRates: {
    adherenceRate: number;
    toleranceRate: number;
    overForcingRate: number;
  },
  timing: {
    ttftP50Ms?: number;
    ttftP95Ms?: number;
    decodeSpeedTokensPerSec?: number;
    decodeSpeedCharsPerSec?: number;
    endToEndMsPerSegment?: number;
    coldLoadMs?: number;
    loadDurationMs?: number;
    promptEvalDurationMs?: number;
    evalDurationMs?: number;
    sizeVramMb?: number;
    sizeMb?: number;
    partiallyOffloaded?: boolean;
  } = {},
  segmentsEvaluated: number = 0
): ModelSummary {
  return {
    modelRef,
    family,
    condition,
    direction,
    dataset,
    chrfPlusPlus: qualityScores.chrfPlusPlus ?? null,
    chrfPlusPlusCI: qualityScores.chrfPlusPlusCI ?? null,
    bleu: qualityScores.bleu ?? null,
    chrfNormalized: qualityScores.chrfNormalized ?? null,
    comet: qualityScores.comet ?? null,
    emptyRate: complianceRates.emptyRate,
    preambleRate: complianceRates.preambleRate,
    markdownFenceRate: complianceRates.markdownFenceRate,
    thinkingTagRate: complianceRates.thinkingTagRate,
    wrongScriptRate: complianceRates.wrongScriptRate,
    repetitionRate: complianceRates.repetitionRate,
    lengthRatioOutOfRangeRate: complianceRates.lengthRatioOutOfRangeRate,
    truncationRate: complianceRates.truncationRate,
    adherenceRate: adherenceRates.adherenceRate,
    toleranceRate: adherenceRates.toleranceRate,
    overForcingRate: adherenceRates.overForcingRate,
    ttftP50Ms: timing?.ttftP50Ms ?? null,
    ttftP95Ms: timing?.ttftP95Ms ?? null,
    decodeSpeedTokensPerSec: timing?.decodeSpeedTokensPerSec ?? null,
    decodeSpeedCharsPerSec: timing?.decodeSpeedCharsPerSec ?? null,
    endToEndMsPerSegment: timing?.endToEndMsPerSegment ?? null,
    coldLoadMs: timing?.coldLoadMs ?? null,
    loadDurationMs: timing?.loadDurationMs ?? null,
    promptEvalDurationMs: timing?.promptEvalDurationMs ?? null,
    evalDurationMs: timing?.evalDurationMs ?? null,
    sizeVramMb: timing?.sizeVramMb ?? null,
    sizeMb: timing?.sizeMb ?? null,
    partiallyOffloaded: timing?.partiallyOffloaded ?? false,
    licence,
    licenceNote,
    segmentsEvaluated,
  };
}

/**
 * Compute percentiles (p50, p95) from an array of numbers.
 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}
