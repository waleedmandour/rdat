#!/usr/bin/env python3
"""
Translation benchmark scorer.

Reads a results JSON from bench-translate.ts, computes chrF++ and BLEU
via sacrebleu, Arabic-normalized chrF, and optional COMET. Outputs a
scored JSON + a summary table.

Usage:
  python bench/translate/python/score.py --input results/<file>.json --output results/<file>-scored.json

Requirements (install once):
  pip install sacrebleu>=2.4
  # Optional (for COMET):
  pip install torch unbabel-comet
"""

import argparse
import json
import os
import sys
from pathlib import Path

# ─── sacrebleu scoring ─────────────────────────────────────────────

def score_chrf(hypotheses, references):
    """Compute chrF++ (word order 2) via sacrebleu."""
    import sacrebleu
    bleu = sacrebleu.corpus_chrf(hypotheses, [references], char_order=6, word_order=2, beta=2)
    return bleu.score

def score_bleu(hypotheses, references):
    """Compute BLEU via sacrebleu."""
    import sacrebleu
    bleu = sacrebleu.corpus_bleu(hypotheses, [references])
    return bleu.score

def paired_bootstrap(hypotheses_sys1, hypotheses_sys2, references, n_samples=1000):
    """Paired bootstrap significance test. Returns (p-value, 95% CI for sys1-sys2)."""
    import sacrebleu
    import random
    random.seed(42)
    n = len(references)
    diffs = []
    for _ in range(n_samples):
        idx = [random.randint(0, n-1) for _ in range(n)]
        refs_sample = [references[i] for i in idx]
        sys1_sample = [hypotheses_sys1[i] for i in idx]
        sys2_sample = [hypotheses_sys2[i] for i in idx]
        s1 = sacrebleu.corpus_chrf(sys1_sample, [refs_sample], char_order=6, word_order=2, beta=2).score
        s2 = sacrebleu.corpus_chrf(sys2_sample, [refs_sample], char_order=6, word_order=2, beta=2).score
        diffs.append(s1 - s2)
    diffs.sort()
    ci_low = diffs[int(0.025 * n_samples)]
    ci_high = diffs[int(0.975 * n_samples)]
    p_value = sum(1 for d in diffs if d <= 0) / n_samples
    return p_value, (ci_low, ci_high)

# ─── Arabic normalization ──────────────────────────────────────────

import re

DIACRITICS = re.compile(r'[\u064B-\u065F\u0670]')
TATWEEL = re.compile(r'\u0640')
BIDI = re.compile(r'[\u200E\u200F\u061C\u202A-\u202E\u2066-\u2069]')

def normalize_arabic(text):
    text = DIACRITICS.sub('', text)
    text = TATWEEL.sub('', text)
    text = BIDI.sub('', text)
    text = text.replace('\u0623', '\u0627').replace('\u0625', '\u0627').replace('\u0622', '\u0627')
    text = text.replace('\u0649', '\u064A')
    text = text.replace('\u0629', '\u0647')
    text = re.sub(r'[\u0660-\u0669]', lambda m: str(ord(m.group()) - 0x0660), text)
    text = re.sub(r'[\u06F0-\u06F9]', lambda m: str(ord(m.group()) - 0x06F0), text)
    text = text.replace('\u060C', ',').replace('\u061B', ';').replace('\u061F', '?')
    text = re.sub(r'\s+', ' ', text).strip()
    return text

# ─── COMET (optional) ──────────────────────────────────────────────

def score_comet(hypotheses, references, sources):
    """Compute COMET score. Requires torch + unbabel-comet."""
    try:
        from comet.models import load_checkpoint
        from comet import download_model
        model_path = download_model("Unbabel/wmt22-comet-da")
        model = load_checkpoint(model_path).to("cpu")
        data = [{"src": s, "mt": h, "ref": r} for s, h, r in zip(sources, hypotheses, references)]
        return model.predict(data, batch_size=8, gpus=0).system_score
    except ImportError:
        print("  COMET: torch or unbabel-comet not available — skipping.", file=sys.stderr)
        return None
    except Exception as e:
        print(f"  COMET: error — {e}", file=sys.stderr)
        return None

# ─── Main ──────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Score translation benchmark results")
    parser.add_argument("--input", required=True, help="Path to results JSON from bench-translate.ts")
    parser.add_argument("--output", required=True, help="Path to scored JSON output")
    parser.add_argument("--baseline", default=None, help="Model ref to use as baseline for paired bootstrap")
    parser.add_argument("--comet", action="store_true", help="Also compute COMET (requires torch + unbabel-comet)")
    args = parser.parse_args()

    with open(args.input) as f:
        data = json.load(f)

    results = data["results"]

    # Group by (candidateRef, condition, direction, dataset)
    groups = {}
    for r in results:
        if r["error"]:
            continue
        key = (r["candidateRef"], r["condition"], r["direction"], r["dataset"])
        groups.setdefault(key, []).append(r)

    print(f"Scoring {len(groups)} model×condition×direction×dataset groups...")

    scored = []
    for key, group in groups.items():
        candidate_ref, condition, direction, dataset = key
        hypotheses = [r["hypoythesis"] if "hypoythesis" in r else r["hypothesis"] for r in group]
        references = [r["reference"] for r in group]
        sources = [r["source"] for r in group]

        # Filter empty hypotheses (counted in compliance, not in chrF)
        non_empty = [(h, r, s) for h, r, s in zip(hypotheses, references, sources) if h.strip()]
        if not non_empty:
            print(f"  SKIP {key}: all hypotheses empty")
            continue

        hyp_ne = [x[0] for x in non_empty]
        ref_ne = [x[1] for x in non_empty]
        src_ne = [x[2] for x in non_empty]

        # chrF++
        chrf = score_chrf(hyp_ne, ref_ne)
        # BLEU (secondary)
        bleu = score_bleu(hyp_ne, ref_ne)
        # Normalized chrF
        hyp_norm = [normalize_arabic(h) for h in hyp_ne]
        ref_norm = [normalize_arabic(r) for r in ref_ne]
        chrf_norm = score_chrf(hyp_norm, ref_norm)

        # COMET (optional)
        comet = score_comet(hyp_ne, ref_ne, src_ne) if args.comet else None

        entry = {
            "candidateRef": candidate_ref,
            "condition": condition,
            "direction": direction,
            "dataset": dataset,
            "chrfPlusPlus": round(chrf, 2),
            "bleu": round(bleu, 2),
            "chrfNormalized": round(chrf_norm, 2),
            "comet": round(comet, 2) if comet is not None else None,
            "segmentsScored": len(non_empty),
            "segmentsEmpty": len(hypotheses) - len(non_empty),
        }
        scored.append(entry)
        print(f"  {candidateRef:45s} {condition:12s} {direction:6s} {dataset:8s} chrF++={chrf:.2f} BLEU={bleu:.2f} chrF_norm={chrf_norm:.2f}")

    output = {
        "timestamp": data["timestamp"],
        "args": data["args"],
        "scored": scored,
    }

    with open(args.output, "w") as f:
        json.dump(output, f, indent=2)
    print(f"\nScored results saved to {args.output}")

if __name__ == "__main__":
    main()
