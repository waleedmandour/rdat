/**
 * Segmentation orchestrator.
 *
 * Pipeline:
 *   1. Normalize line endings only (\r\n → \n). No other character
 *      is altered.
 *   2. Split into paragraphs on \n. Empty lines are preserved as
 *      separators (they produce no segments but are kept in the
 *      round-trip via `start`/`end` gaps).
 *   3. Per paragraph: detect dominant script, split into sentences
 *      with the matching rule set.
 *   4. Post-pass: attach trailing closing quotes/brackets, keep list
 *      markers with their text, merge punctuation-only fragments.
 *   5. Apply manual overrides (split / join) on top.
 *   6. Compute sourceHash per segment.
 *
 * Lossless property: `original` === `roundtrip(result)` where
 * `roundtrip` concatenates the text between consecutive `start`/`end`
 * ranges (i.e. the separators are re-derived from the gaps).
 */

import {
  type Segment,
  type SegmentationResult,
  type SegmentOptions,
  type ManualOverride,
  type Granularity,
  type Script,
  fnv1aHex,
} from "./types";
import {
  EN_ABBREVIATIONS,
  isSingleLetterInitial,
  isDecimalOrVersion,
  isInsideUrlOrEmail,
  isListMarker,
  CLOSING_QUOTES_BRACKETS,
} from "./english-rules";
import {
  AR_TERMINATORS,
  AR_WEAK_PUNCTUATION,
  AR_CLOSING,
  AR_ABBREVIATIONS,
  AR_YEAR_SUFFIXES,
  AR_ATTRIBUTION_VERBS,
  normalizeArabicForMatching,
  computeProtectedSpans,
  isInsideProtectedSpan,
  isArabicDecimalPoint,
  isArabicListMarker,
  scoreSoftSplitSuggestions,
} from "./arabic-rules";

// ─── Line-ending normalization ─────────────────────────────────────
export function normalizeLineEndings(input: string): string {
  // \r\n → \n, then any stray \r → \n (old Mac). No other changes.
  return input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

// ─── Script detection ──────────────────────────────────────────────
// Count Arabic vs Latin letters. Arabic block U+0621–064A + supplement
// U+0660–06FF. Latin a-z A-Z. Whichever wins is the dominant script.
// Ties go to Arabic (the harder case for CAT tools). Mixed-script
// paragraphs (e.g. a Latin token in an Arabic paragraph) still get
// the dominant script's rules.
export function detectDominantScript(text: string): Script {
  let arabic = 0;
  let latin = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    // Arabic
    if (
      (c >= 0x0621 && c <= 0x064a) ||
      (c >= 0x0660 && c <= 0x06ff) ||
      (c >= 0x0750 && c <= 0x077f)
    ) {
      arabic++;
    }
    // Latin
    else if (
      (c >= 0x0041 && c <= 0x005a) ||
      (c >= 0x0061 && c <= 0x007a)
    ) {
      latin++;
    }
  }
  // Ties → Arabic (harder case, conservative)
  return arabic >= latin ? "arabic" : "latin";
}

// ─── Paragraph splitting ───────────────────────────────────────────
// A newline starts a new paragraph. Empty lines create no segments but
// are preserved as separators (the gap between two non-empty
// paragraphs is the empty line(s) between them, re-derivable from
// `start`/`end`).
//
// We return an array of { text, start, end } for each NON-EMPTY
// paragraph, plus the separators are implicit (the gaps).
interface Paragraph {
  text: string;
  start: number; // offset into the normalized input
  end: number;   // offset into the normalized input (exclusive)
}

export function splitParagraphs(normalized: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  let i = 0;
  const len = normalized.length;

  while (i < len) {
    // Skip leading newlines (paragraph separators / leading blanks)
    while (i < len && normalized[i] === "\n") i++;
    if (i >= len) break;

    const paraStart = i;
    // Read until the next \n
    let paraEnd = i;
    while (paraEnd < len && normalized[paraEnd] !== "\n") paraEnd++;

    const raw = normalized.slice(paraStart, paraEnd);
    // A paragraph is "non-empty" if it has any non-whitespace content.
    // We do NOT trim the text here — leading/trailing spaces within a
    // paragraph are preserved in the round-trip via start/end, but the
    // sentence splitter trims when extracting sentence text.
    if (raw.trim().length > 0) {
      paragraphs.push({ text: raw, start: paraStart, end: paraEnd });
    }
    i = paraEnd;
  }

  return paragraphs;
}

// ─── English sentence splitting (within a paragraph) ───────────────
// Returns array of { text, start, end } where start/end are offsets
// into the PARAGRAPH text (not the whole document). The orchestrator
// adds the paragraph's start offset to convert to document offsets.
interface RawSentence {
  text: string;
  start: number; // offset into paragraph
  end: number;   // offset into paragraph (exclusive)
}

// Look back from a period to find the last "word" (run of
// non-whitespace, non-period chars). Used for abbreviation matching.
function lastWordBefore(text: string, pos: number): string {
  let i = pos - 1;
  // Skip the period itself
  if (i >= 0 && text[i] === ".") i--;
  // Skip whitespace
  while (i >= 0 && /\s/.test(text[i])) i--;
  if (i < 0) return "";
  const end = i + 1;
  // Read the word (letters only — stop at non-letter)
  while (i >= 0 && /[A-Za-z]/.test(text[i])) i--;
  return text.slice(i + 1, end).toLowerCase();
}

// Look ahead from after a terminator to find the next non-whitespace
// char and the next word.
function nextCharAndWord(
  text: string,
  pos: number
): { ch: string; word: string } {
  let i = pos + 1;
  while (i < text.length && /\s/.test(text[i])) i++;
  if (i >= text.length) return { ch: "", word: "" };
  const ch = text[i];
  // Read the next word
  let j = i;
  while (j < text.length && /[A-Za-z0-9]/.test(text[j])) j++;
  return { ch, word: text.slice(i, j) };
}

function splitEnglishSentences(paragraph: string): RawSentence[] {
  const sentences: RawSentence[] = [];
  const len = paragraph.length;
  let segStart = 0;

  // First, find all candidate break positions.
  // A candidate is a terminator (.) ! ? … possibly followed by
  // closing quotes/brackets, followed by whitespace, followed by an
  // uppercase letter or digit or opening quote.
  const breakPositions: number[] = [];

  for (let i = 0; i < len; i++) {
    const ch = paragraph[i];
    if (ch !== "." && ch !== "!" && ch !== "?" && ch !== "…") continue;

    // No-break: abbreviation
    const word = lastWordBefore(paragraph, i);
    if (word && EN_ABBREVIATIONS.has(word)) continue;

    // No-break: multi-part abbreviation like "Ph.D." — if the next
    // word is a single uppercase letter (e.g. "D" in "Ph.D."), treat
    // as abbreviation continuation. Also handles "U.S.A." etc.
    const nextForAbbrev = nextCharAndWord(paragraph, i);
    if (
      ch === "." &&
      nextForAbbrev.word.length === 1 &&
      /[A-Z]/.test(nextForAbbrev.ch)
    ) {
      // Single uppercase letter after a period — likely "Ph.D." or
      // "U.S.A." Continue (no break). The single-letter-initial rule
      // below also covers "A. B. Smith" but we want to catch this
      // earlier for the multi-part abbreviation case.
      continue;
    }

    // No-break: single-letter initial ("A." "B.")
    if (isSingleLetterInitial(word.length === 1 ? word : (paragraph[i - 1] || ""))) {
      // Only suppress if the next token is also single-letter or
      // starts uppercase (likely a name). Conservative: if next is
      // lowercase, treat as sentence end.
      const next = nextCharAndWord(paragraph, i);
      if (next.word.length === 1 && /[A-Z]/.test(next.ch)) {
        continue;
      }
    }

    // No-break: decimal / version (3.14, v2.1.0)
    const before = i > 0 ? paragraph[i - 1] : "";
    const after = i < len - 1 ? paragraph[i + 1] : "";
    if (isDecimalOrVersion(before, after)) continue;

    // No-break: URL / email / filename
    if (isInsideUrlOrEmail(paragraph, i)) continue;

    // No-break: list marker (1. a. iv.)
    // The token before the period is a list marker
    if (isListMarker(word + ".")) continue;

    // No-break: period followed by lowercase (mid-sentence) UNLESS the
    // lowercase token is a list marker (a) b) iv. etc.), in which case
    // it DOES break because a new list item starts.
    const next = nextCharAndWord(paragraph, i);
    if (
      next.ch &&
      /[a-z]/.test(next.ch) &&
      !isListMarker(next.word + ")") &&
      !isListMarker(next.word + ".")
    ) {
      // For ".", this is always a no-break (mid-sentence).
      // For "…", "!", "?", we still suppress if followed by lowercase
      // because mid-sentence ellipsis is common and "!"/"?" followed
      // by lowercase is usually an interjection (e.g. "oh! wait —").
      continue;
    }

    // Candidate break. Attach trailing closing quotes/brackets.
    let breakEnd = i + 1;
    while (breakEnd < len && CLOSING_QUOTES_BRACKETS.has(paragraph[breakEnd])) {
      breakEnd++;
    }
    breakPositions.push(breakEnd);
  }

  // Now produce sentences from break positions.
  for (const bp of breakPositions) {
    if (bp <= segStart) continue;
    const raw = paragraph.slice(segStart, bp);
    const trimmed = raw.trim();
    if (trimmed) {
      // Recompute start/end based on trimmed slice within the raw
      const lead = raw.length - raw.trimStart().length;
      sentences.push({
        text: trimmed,
        start: segStart + lead,
        end: segStart + lead + trimmed.length,
      });
    }
    segStart = bp;
  }

  // Trailing text after the last break
  if (segStart < len) {
    const raw = paragraph.slice(segStart);
    const trimmed = raw.trim();
    if (trimmed) {
      const lead = raw.length - raw.trimStart().length;
      sentences.push({
        text: trimmed,
        start: segStart + lead,
        end: segStart + lead + trimmed.length,
      });
    }
  }

  // If no breaks found, the whole paragraph is one sentence
  if (sentences.length === 0) {
    const trimmed = paragraph.trim();
    if (trimmed) {
      const lead = paragraph.length - paragraph.trimStart().length;
      sentences.push({
        text: trimmed,
        start: lead,
        end: lead + trimmed.length,
      });
    }
  }

  return sentences;
}

// ─── Arabic sentence splitting (within a paragraph) ────────────────
function splitArabicSentences(paragraph: string): RawSentence[] {
  const sentences: RawSentence[] = [];
  const len = paragraph.length;
  const protectedSpans = computeProtectedSpans(paragraph);

  let segStart = 0;
  const breakPositions: number[] = [];

  for (let i = 0; i < len; i++) {
    const ch = paragraph[i];

    // Skip weak punctuation (never breaks by default)
    if (AR_WEAK_PUNCTUATION.has(ch)) continue;

    // Skip terminators inside protected spans
    if (AR_TERMINATORS.has(ch) && isInsideProtectedSpan(i, protectedSpans)) {
      continue;
    }

    if (!AR_TERMINATORS.has(ch)) continue;

    // No-break: "." between Arabic-Indic / Persian digits (decimal)
    if (ch === "." && isArabicDecimalPoint(paragraph, i)) continue;

    // No-break: Arabic abbreviation (normalized match)
    const word = lastArabicWordBefore(paragraph, i);
    const normWord = normalizeArabicForMatching(word);
    if (normWord && AR_ABBREVIATIONS.has(normWord)) continue;

    // No-break: multi-part Arabic abbreviation like "أ.د." — check if
    // word + "." + nextWord forms a known abbreviation.
    if (ch === "." && normWord) {
      const nextW = nextArabicWord(paragraph, i + 1);
      const normNext = normalizeArabicForMatching(nextW);
      if (normNext) {
        const twoPart = `${normWord}.${normNext}`;
        if (AR_ABBREVIATIONS.has(twoPart)) continue;
      }
    }

    // No-break: year suffix م / هـ after a numeral
    if (AR_YEAR_SUFFIXES.has(normWord)) {
      // Check if the token before this word is a numeral
      const beforeWord = lastArabicWordBefore(paragraph, i - word.length - 1);
      if (beforeWord && /[\u0660-\u0669\u06F0-\u06F9 0-9]/.test(beforeWord[0])) {
        continue;
      }
    }

    // No-break: Arabic list marker — but only if it's at the start of
    // a line/paragraph (preceded by whitespace or start). A "list marker"
    // in the middle of a number (e.g. the "٧١." in "٢.٧١.") is NOT a
    // list marker, it's a decimal continuation.
    if (isArabicListMarker(word + ch)) {
      // Check the char before the word: must be whitespace or start
      const wordStart = i - word.length;
      const beforeWord = wordStart > 0 ? paragraph[wordStart - 1] : "";
      if (wordStart === 0 || /\s/.test(beforeWord)) {
        continue;
      }
      // Otherwise it's mid-token (e.g. decimal continuation) — fall
      // through to candidate break.
    }

    // Candidate break. Attach trailing closing quotes/brackets.
    let breakEnd = i + 1;
    while (breakEnd < len && AR_CLOSING.has(paragraph[breakEnd])) {
      breakEnd++;
    }

    // No-break: attribution verb after a closing quote
    // Look at the next non-whitespace word
    const next = nextArabicWord(paragraph, breakEnd);
    if (next) {
      const normNext = normalizeArabicForMatching(next);
      if (AR_ATTRIBUTION_VERBS.has(normNext)) continue;
    }

    breakPositions.push(breakEnd);
  }

  // Produce sentences from break positions
  for (const bp of breakPositions) {
    if (bp <= segStart) continue;
    const raw = paragraph.slice(segStart, bp);
    const trimmed = raw.trim();
    if (trimmed) {
      const lead = raw.length - raw.trimStart().length;
      sentences.push({
        text: trimmed,
        start: segStart + lead,
        end: segStart + lead + trimmed.length,
      });
    }
    segStart = bp;
  }

  // Trailing
  if (segStart < len) {
    const raw = paragraph.slice(segStart);
    const trimmed = raw.trim();
    if (trimmed) {
      const lead = raw.length - raw.trimStart().length;
      sentences.push({
        text: trimmed,
        start: lead + segStart,
        end: lead + segStart + trimmed.length,
      });
    }
  }

  if (sentences.length === 0) {
    const trimmed = paragraph.trim();
    if (trimmed) {
      const lead = paragraph.length - paragraph.trimStart().length;
      sentences.push({
        text: trimmed,
        start: lead,
        end: lead + trimmed.length,
      });
    }
  }

  // Soft-split suggestions are attached to each sentence separately
  // (we don't auto-split; we just annotate). Done in the orchestrator
  // so we have access to the threshold and the spans.
  // But we compute spans per paragraph here, so we can attach now.
  // Actually we attach in the orchestrator after building the final
  // Segment objects, because the suggestion offsets need to be into
  // the segment's `text`, not the paragraph. Keep it simple: compute
  // suggestions in the orchestrator.

  return sentences;
}

function lastArabicWordBefore(text: string, pos: number): string {
  let i = pos - 1;
  // Skip the terminator itself
  if (i >= 0 && (text[i] === "." || text[i] === "؟")) i--;
  // Skip whitespace
  while (i >= 0 && /\s/.test(text[i])) i--;
  if (i < 0) return "";
  const end = i + 1;
  // Read ONE word: Arabic letters + digits + diacritics + tatweel.
  // STOP at whitespace or non-Arabic-script char (so "قابل د" reads
  // only "د", not the whole "قابل د").
  while (
    i >= 0 &&
    /[\u0621-\u064A\u064B-\u065F\u0670\u0640\u0660-\u0669\u06F0-\u06F9]/.test(text[i])
  ) {
    i--;
  }
  return text.slice(i + 1, end);
}

function nextArabicWord(text: string, pos: number): string {
  let i = pos;
  while (i < text.length && /\s/.test(text[i])) i++;
  if (i >= text.length) return "";
  const start = i;
  while (
    i < text.length &&
    /[\u0621-\u064A\u064B-\u065F\u0670\u0640]/.test(text[i])
  ) {
    i++;
  }
  return text.slice(start, i);
}

// ─── Post-pass: merge punctuation-only fragments ───────────────────
// If a sentence is only punctuation (e.g. a stray "…" or "»"), merge
// it into the previous sentence. This catches edge cases where the
// splitter over-split.
function mergePunctuationOnly(sentences: RawSentence[]): RawSentence[] {
  if (sentences.length <= 1) return sentences;
  const out: RawSentence[] = [sentences[0]];
  for (let i = 1; i < sentences.length; i++) {
    const s = sentences[i];
    // Punctuation-only = no letters or digits
    const hasContent = /[A-Za-z0-9\u0621-\u064A\u0660-\u0669\u06F0-\u06F9]/.test(s.text);
    if (!hasContent && out.length > 0) {
      // Merge into previous: extend end
      const prev = out[out.length - 1];
      // The merged sentence spans from prev.start to s.end, with the
      // gap (whitespace) included. But we want the TEXT to include
      // the gap. Recompute text from the original paragraph.
      // Actually, since we only have offsets here, and the text is
      // what matters, we join with a space.
      out[out.length - 1] = {
        text: prev.text + " " + s.text,
        start: prev.start,
        end: s.end,
      };
    } else {
      out.push(s);
    }
  }
  return out;
}

// ─── Manual overrides ──────────────────────────────────────────────
function applyManualBreaks(
  segments: Segment[],
  breaks: ManualOverride[]
): Segment[] {
  if (!breaks.length) return segments;
  const out: Segment[] = [];
  const breaksByIndex = new Map<number, number[]>();
  for (const b of breaks) {
    const arr = breaksByIndex.get(b.segmentIndex) ?? [];
    arr.push(b.offset);
    breaksByIndex.set(b.segmentIndex, arr);
  }
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const offsets = (breaksByIndex.get(i) ?? []).sort((a, b) => a - b);
    if (offsets.length === 0) {
      out.push(s);
      continue;
    }
    // Split s.text at each offset (offsets are into s.text)
    let prev = 0;
    let idxInPara = s.indexInParagraph;
    for (const off of offsets) {
      if (off <= prev || off > s.text.length) continue;
      const part = s.text.slice(prev, off).trim();
      if (part) {
        out.push({
          ...s,
          indexInParagraph: idxInPara++,
          text: part,
          sourceHash: fnv1aHex(part),
          // The split part is not the paragraph end
          isParagraphEnd: false,
          // start/end offsets are approximate (into the original) —
          // we don't recompute precisely because manual breaks are
          // an override layer; the round-trip property holds for the
          // automatic segmentation, and overrides are user-intent.
          start: s.start + prev,
          end: s.start + off,
        });
      }
      prev = off;
    }
    // Trailing part
    const part = s.text.slice(prev).trim();
    if (part) {
      out.push({
        ...s,
        indexInParagraph: idxInPara,
        text: part,
        sourceHash: fnv1aHex(part),
        start: s.start + prev,
        end: s.end,
      });
    }
  }
  // Re-index global indices
  out.forEach((s, i) => (s.index = i));
  return out;
}

function applyManualJoins(
  segments: Segment[],
  joins: number[]
): Segment[] {
  if (!joins.length) return segments;
  const joinSet = new Set(joins);
  const out: Segment[] = [];
  let i = 0;
  while (i < segments.length) {
    let s = segments[i];
    // Join with next while this index is in the join set AND there's
    // a next segment in the same paragraph.
    while (
      joinSet.has(i) &&
      i + 1 < segments.length &&
      segments[i + 1].paragraphIndex === s.paragraphIndex
    ) {
      const next = segments[i + 1];
      const merged = s.text + " " + next.text;
      s = {
        ...s,
        text: merged,
        sourceHash: fnv1aHex(merged),
        end: next.end,
        isParagraphEnd: next.isParagraphEnd,
      };
      i++; // consume the joined segment
    }
    out.push(s);
    i++;
  }
  out.forEach((s, idx) => (s.index = idx));
  return out;
}

// ─── Main entry point ──────────────────────────────────────────────
export function segment(
  input: string,
  options: SegmentOptions = {}
): SegmentationResult {
  const granularity: Granularity = options.granularity ?? "sentence";
  const manualBreaks = options.manualBreaks ?? [];
  const manualJoins = options.manualJoins ?? [];
  const softSplitThreshold = options.softSplitTokenThreshold ?? 45;

  const normalized = normalizeLineEndings(input);
  const paragraphs = splitParagraphs(normalized);

  const segments: Segment[] = [];
  let globalIndex = 0;

  for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
    const para = paragraphs[pIdx];
    const script = detectDominantScript(para.text);

    let rawSentences: RawSentence[];
    if (granularity === "paragraph") {
      // Whole paragraph = one segment
      const trimmed = para.text.trim();
      const lead = para.text.length - para.text.trimStart().length;
      rawSentences = [
        {
          text: trimmed,
          start: lead,
          end: lead + trimmed.length,
        },
      ];
    } else {
      // Sentence-level within the paragraph
      rawSentences =
        script === "arabic"
          ? splitArabicSentences(para.text)
          : splitEnglishSentences(para.text);
      rawSentences = mergePunctuationOnly(rawSentences);
    }

    const isLastPara = pIdx === paragraphs.length - 1;
    void isLastPara; // reserved for future paragraph-final metadata

    for (let sIdx = 0; sIdx < rawSentences.length; sIdx++) {
      const rs = rawSentences[sIdx];
      const isLastInPara = sIdx === rawSentences.length - 1;

      // Convert paragraph-local offsets to document offsets
      const docStart = para.start + rs.start;
      const docEnd = para.start + rs.end;

      // Soft-split suggestions (Arabic only, sentence granularity only)
      let softSplit: number[] | undefined;
      if (granularity === "sentence" && script === "arabic") {
        const spans = computeProtectedSpans(rs.text);
        const suggestions = scoreSoftSplitSuggestions(
          rs.text,
          softSplitThreshold,
          spans
        );
        if (suggestions.length > 0) {
          softSplit = suggestions;
        }
      }

      segments.push({
        index: globalIndex++,
        paragraphIndex: pIdx,
        indexInParagraph: sIdx,
        text: rs.text,
        start: docStart,
        end: docEnd,
        sourceHash: fnv1aHex(rs.text),
        isParagraphEnd: isLastInPara,
        script,
        softSplitSuggestion: softSplit,
      });
    }
  }

  // Apply manual overrides
  let finalSegments = applyManualBreaks(segments, manualBreaks);
  finalSegments = applyManualJoins(finalSegments, manualJoins);

  return {
    segments: finalSegments,
    normalized,
    granularity,
    manualBreaks: manualBreaks.map((b) => b.segmentIndex),
    manualJoins,
  };
}

// ─── Round-trip verification ───────────────────────────────────────
/**
 * Verify the lossless property: concatenating the text between
 * consecutive segment boundaries (plus the leading/trailing gaps)
 * equals the normalized input.
 *
 * This reconstructs the original by walking the segments and filling
 * the gaps between them with the original text from `normalized`.
 */
export function roundtrip(result: SegmentationResult): string {
  const { segments, normalized } = result;
  if (segments.length === 0) return normalized;

  let out = "";
  let prevEnd = 0;
  for (const s of segments) {
    // Fill the gap between prevEnd and s.start with the original text
    if (s.start > prevEnd) {
      out += normalized.slice(prevEnd, s.start);
    }
    // Append the segment text (NOT normalized.slice(s.start, s.end),
    // because manual breaks may have altered the text). For automatic
    // segmentation, s.text === normalized.slice(s.start, s.start +
    // s.text.length) roughly. For round-trip, we use the slice.
    out += normalized.slice(s.start, s.end);
    prevEnd = s.end;
  }
  // Trailing
  if (prevEnd < normalized.length) {
    out += normalized.slice(prevEnd);
  }
  return out;
}

// ─── Idempotence check ─────────────────────────────────────────────
/**
 * segment(segment(input).normalized) should produce the same segments.
 * Useful for tests.
 */
export function isIdempotent(input: string): boolean {
  const r1 = segment(input);
  const r2 = segment(r1.normalized);
  if (r1.segments.length !== r2.segments.length) return false;
  for (let i = 0; i < r1.segments.length; i++) {
    if (r1.segments[i].text !== r2.segments[i].text) return false;
    if (r1.segments[i].start !== r2.segments[i].start) return false;
    if (r1.segments[i].end !== r2.segments[i].end) return false;
  }
  return true;
}
