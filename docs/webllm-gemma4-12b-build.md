# Gemma 4 12B — WebLLM Build Recipe

## Status: **No verified MLC/WebLLM build exists (Branch B)**

As of 2026-10-03, `google/gemma-4-12B-it` is released on Hugging Face
under Apache 2.0 (`model_type: gemma4_unified`, architecture
`Gemma4UnifiedForConditionalGeneration`, multimodal image-text-to-text),
but **no MLC-converted q4f16_1 build exists** for WebLLM/WebGPU.

A Hugging Face search for `gemma-4 12B MLC` returns 0 results. The
`mlc-ai` organization ships only Gemma 3 4B MLC builds. The only
verified Gemma 4 MLC artifact is a community E4B build at
`welcoma/gemma-4-E4B-it-q4f16_1-MLC` (labelled "Experimental" in the
catalog; its README states "build candidate, not an official mlc-ai
release … browser runtime validation still required").

This document describes the exact `mlc_llm` recipe to produce a
12B WebLLM build once you have the compute. Adding the resulting
artifact to RDAT is a one-line addition to `src/lib/webllm-catalog.ts`.

---

## Prerequisites

- An L4/A10/A100/H100 GPU with ≥ 64 GB VRAM (12B q4f16_1 ≈ 7 GB
  weights, but conversion needs the full fp16 model in memory).
- Python 3.10+, `torch`, `mlc_llm`, `tvm` (built from source or the
  nightly wheel).
- Emscripten 3.1.x (for the WebGPU wasm compile).
- The `google/gemma-4-12B-it` model downloaded from Hugging Face
  (gated — accept the license first).

```bash
# Clone mlc-llm at the commit used for the verified E4B build
# (provenance: welcoma/gemma-4-E4B-it-q4f16_1-MLC/build-provenance.json)
git clone https://github.com/mlc-ai/mlc-llm.git
cd mlc-llm
git checkout 22fe4b7e2e68ff00c12c2069de2060bce3cfe62d
git submodule update --init --recursive

pip install -e . -v
```

## Step 1: Convert weights

```bash
mlc_llm convert_weight \
  /path/to/google/gemma-4-12B-it \
  --quantization q4f16_1 \
  --model-type gemma4 \
  --device cuda:0 \
  --output /path/to/output/gemma-4-12B-it-q4f16_1-MLC
```

## Step 2: Generate config

```bash
mlc_llm gen_config \
  /path/to/google/gemma-4-12B-it \
  --quantization q4f16_1 \
  --model-type gemma4 \
  --conv-template gemma4_instruction \
  --context-window-size 4096 \
  --prefill-chunk-size 512 \
  --sliding-window-size 512 \
  --output /path/to/output/gemma-4-12B-it-q4f16_1-MLC
```

This produces `mlc-chat-config.json` with:
- `model_type: "gemma4"`
- `quantization: "q4f16_1"`
- `conv_template: "gemma4_instruction"`
- `context_window_size: 4096`
- `prefill_chunk_size: 512`
- `sliding_window_size: 512`

## Step 3: Compile for WebGPU

```bash
mlc_llm compile \
  /path/to/output/gemma-4-12B-it-q4f16_1-MLC/mlc-chat-config.json \
  --device webgpu \
  --output /path/to/output/gemma-4-12B-it-q4f16_1-MLC/libs/gemma-4-12B-it-q4f16_1-MLC-webgpu.wasm
```

This produces the `.wasm` model library that WebLLM loads at runtime.

## Step 4: Upload to Hugging Face

```bash
# Create a repo, e.g. your-org/gemma-4-12B-it-q4f16_1-MLC
huggingface-cli login
huggingface-cli upload your-org/gemma-4-12B-it-q4f16_1-MLC \
  /path/to/output/gemma-4-12B-it-q4f16_1-MLC \
  --repo-type model
```

Verify the upload includes:
- `mlc-chat-config.json`
- `libs/gemma-4-12B-it-q4f16_1-MLC-webgpu.wasm`
- `params_shard_*.bin` (weight shards)
- `ndarray-cache.json` (weight manifest)

## Step 5: Add to RDAT catalog

Add a one-line entry to `MODELS` in `src/lib/webllm-catalog.ts`:

```typescript
{
  id: "gemma-4-12b",
  name: "Gemma 4 12B IT",
  parameters: "12B",
  size: "~7.0 GB",
  family: "Gemma",
  mlcModelId: "gemma-4-12B-it-q4f16_1-MLC",
  model: "https://huggingface.co/your-org/gemma-4-12B-it-q4f16_1-MLC/resolve/main/",
  modelLib: "https://huggingface.co/your-org/gemma-4-12B-it-q4f16_1-MLC/resolve/main/libs/gemma-4-12B-it-q4f16_1-MLC-webgpu.wasm",
  vramRequiredMB: 9216,
  requiredFeatures: ["shader-f16"],
  badge: "Highest quality",
  contextWindow: 4096,
  convTemplate: "gemma4_instruction",
},
```

## Step 6: Browser runtime validation

Before labelling the entry "Highest quality" (removing the
"Experimental" caveat), validate on a real WebGPU device:

1. Open RDAT in Chrome 113+ (or Edge 113+) with WebGPU enabled.
2. Open the Models panel, verify the 12B model appears with the
   correct size/VRAM/badge.
3. Click Download — verify the weight shards + wasm fetch from HF
   without CORS errors (the service worker must not intercept
   cross-origin model traffic — see `public/sw.js`).
4. Click Load — verify `CreateMLCEngine` succeeds with the custom
   `appConfig.model_list`. Check the browser console for WebGPU
   errors.
5. Type a short English segment in EN→AR mode — verify a ghost-text
   suggestion appears within ~5 seconds and contains no
   thinking/reasoning markup (the `stripThinkingMarkup` post-
   processor in `local-llm-engine.ts` handles this, but verify).
6. Test AR→EN similarly.
7. Test on a device with limited VRAM — verify the capability
   gating warns (does not hard-block) appropriately.

## What's missing for a 12B build

1. **No one has run the recipe above for the 12B model.** The E4B
   build exists because `welcoma` ran it for the E4B variant. The 12B
   variant needs ~2× the VRAM for conversion and ~7 GB for browser
   inference — feasible on an A100/H100 for conversion, and on a
   device with ≥ 12 GB VRAM for inference.
2. **Browser runtime validation.** Even once a build exists, it must
   be validated on a WebGPU device that exposes `shader-f16`. The E4B
   build's provenance explicitly says this is pending.
3. **WebLLM runtime compatibility.** The build's `mlc-chat-config.json`
   `model_type` (`gemma4`) must be supported by the installed
   `@mlc-ai/web-llm` version (currently 0.2.84). If the runtime needs
   an upgrade, bump minimally and re-run every gate.

## References

- Upstream model: https://huggingface.co/google/gemma-4-12B-it
- Community E4B build (reference): https://huggingface.co/welcoma/gemma-4-E4B-it-q4f16_1-MLC
- E4B build provenance: `welcoma/gemma-4-E4B-it-q4f16_1-MLC/build-provenance.json`
- mlc-llm docs: https://llm.mlc.ai/docs/
- WebLLM model config: https://github.com/mlc-ai/web-llm/blob/main/src/config.ts
