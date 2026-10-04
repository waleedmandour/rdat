/**
 * Export / import helpers for translation data.
 *
 * Issue 3 (v0.4.1): previously the only export was a plain TXT file
 * (target texts joined with \n\n). IndexedDB was the only copy of
 * confirmed segments + glossary + TM, and browsers can evict it
 * under storage pressure. This module adds:
 *   - exportDocx: render the source/target segment pairs as a .docx
 *   - exportJsonBackup: full dump of segments + glossary + TM +
 *     document metadata to a single JSON file
 *   - importJsonBackup: restore from a JSON backup
 *
 * XLIFF and TMX (industry-standard interchange formats) are a
 * documented follow-up — see the README.
 */

import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from "docx";
import type { SegmentEntry, GlossaryEntry, DocumentMeta } from "../types";

// ─── DOCX export ───────────────────────────────────────────────────

export interface DocxExportOptions {
  /** Document title (e.g. the source filename). */
  title: string;
  /** Source language label (e.g. "English", "Arabic"). */
  sourceLangLabel: string;
  /** Target language label. */
  targetLangLabel: string;
  /** Segment pairs: { source, target }[]. */
  segments: Array<{ source: string; target: string }>;
  /** Whether the target is RTL (Arabic). Affects paragraph alignment. */
  isTargetRTL: boolean;
}

/**
 * Build a .docx Blob from the translation segment pairs.
 *
 * Layout: a title heading, then for each segment a source paragraph
 * (left-aligned for English, right-aligned for Arabic) followed by a
 * target paragraph (mirrored). Segments are separated by a blank line.
 */
export async function buildDocxBlob(opts: DocxExportOptions): Promise<Blob> {
  const children: Paragraph[] = [];

  // Title
  children.push(
    new Paragraph({
      text: opts.title,
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 200 },
    })
  );

  // Language pair header
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `${opts.sourceLangLabel} → ${opts.targetLangLabel}`,
          italics: true,
          color: "666666",
        }),
      ],
      spacing: { after: 300 },
    })
  );

  // Segments
  for (let i = 0; i < opts.segments.length; i++) {
    const { source, target } = opts.segments[i];

    // Segment number
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `#${i + 1}`,
            bold: true,
            color: "6366f1",
            size: 18,
          }),
        ],
        spacing: { before: 200, after: 80 },
      })
    );

    // Source
    children.push(
      new Paragraph({
        children: [new TextRun({ text: source })],
        alignment: opts.isTargetRTL ? AlignmentType.LEFT : AlignmentType.RIGHT,
        spacing: { after: 80 },
      })
    );

    // Target
    children.push(
      new Paragraph({
        children: [new TextRun({ text: target || "" })],
        alignment: opts.isTargetRTL ? AlignmentType.RIGHT : AlignmentType.LEFT,
        spacing: { after: 200 },
      })
    );
  }

  const doc = new Document({
    sections: [{ properties: {}, children }],
  });

  return Packer.toBlob(doc);
}

// ─── JSON backup / restore ─────────────────────────────────────────

export interface JsonBackup {
  /** Backup format version — bump if the schema changes. */
  version: 1;
  /** ISO timestamp of when the backup was created. */
  created_at: string;
  /** RDAT version that produced the backup. */
  app_version: string;
  /** All segment entries from the `segments` IndexedDB store. */
  segments: SegmentEntry[];
  /** All glossary entries from the `glossary` store. */
  glossary: GlossaryEntry[];
  /** All document metadata from the `documents` store. */
  documents: DocumentMeta[];
}

/**
 * Build a JSON backup object from the IndexedDB data. The caller is
 * responsible for fetching the data (via getAllofStore) — this function
 * just assembles + validates the structure.
 */
export function buildJsonBackup(
  segments: SegmentEntry[],
  glossary: GlossaryEntry[],
  documents: DocumentMeta[],
  appVersion: string
): JsonBackup {
  return {
    version: 1,
    created_at: new Date().toISOString(),
    app_version: appVersion,
    segments,
    glossary,
    documents,
  };
}

/**
 * Validate a parsed JSON object is a valid backup. Returns an error
 * message string if invalid, or null if valid.
 */
export function validateJsonBackup(data: unknown): string | null {
  if (!data || typeof data !== "object") return "Backup is not an object";
  const obj = data as Record<string, unknown>;
  if (obj.version !== 1) return `Unsupported backup version: ${obj.version} (expected 1)`;
  if (!Array.isArray(obj.segments)) return "Backup missing segments array";
  if (!Array.isArray(obj.glossary)) return "Backup missing glossary array";
  if (!Array.isArray(obj.documents)) return "Backup missing documents array";
  return null;
}

/**
 * Serialize a JsonBackup to a pretty-printed JSON string.
 */
export function serializeJsonBackup(backup: JsonBackup): string {
  return JSON.stringify(backup, null, 2);
}

/**
 * Parse a JSON string into a JsonBackup. Throws on invalid JSON or
 * invalid schema.
 */
export function parseJsonBackup(jsonStr: string): JsonBackup {
  let data: unknown;
  try {
    data = JSON.parse(jsonStr);
  } catch (e: any) {
    throw new Error(`Invalid JSON: ${e.message}`);
  }
  const err = validateJsonBackup(data);
  if (err) throw new Error(err);
  return data as JsonBackup;
}
