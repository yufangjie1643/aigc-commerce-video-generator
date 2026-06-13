---
name: video-generation-pipeline
description: Use when Codex needs to structure ingested ecommerce video assets from the product asset library or commerce video library, slice and understand multimodal materials, extract product/video/slice dimensions, build embeddings and retrieval-ready asset contracts, or turn multiple reference videos into a repeatable AI video generation pipeline consumed by script and creation modules.
triggers:
  - "素材库方法论提炼"
  - "带货视频生成流水线"
  - "爆款视频结构提炼"
  - "video generation pipeline"
  - "commerce video methodology"
  - "asset library generation pipeline"
od:
  mode: utility
  category: video-generation
  surface: video
  asset_library:
    sections:
      - commerce-videos
      - products
    consumes:
      - storyboard_json
      - product_dimensions
      - video_dimensions
      - slice_dimensions
    outputs:
      - technique_library
      - generation_pipeline
      - downstream_contract
  capabilities_required:
    - local_file_read
    - file_write
---

# Video Generation Pipeline

## Overview

Convert ingested videos into structured assets first, then into a practical generation pipeline. Always separate observed product/video/slice evidence from invented creative choices, and make the output consumable by script generation, material retrieval, and creation/edit modules.

## Workflow

1. Ingest assets and preserve source metadata: asset id/path, category, product hint, copyright policy, file metadata, and project/collection membership.
2. Slice each video into semantically meaningful scenes/shots. Use `video-storyboard-analysis` or `scripts/batch_analyze_videos.py` when detailed multimodal parsing is needed.
3. Extract three granularities: product dimensions, video dimensions, and slice dimensions. See `references/structured-asset-contract.md`.
4. Generate embedding text at video and slice levels so recall can work across `asset`, `asset_file`, and `asset_slice`.
5. Build a technique matrix from all structured storyboard JSON files with `scripts/build_pipeline_from_storyboards.py`.
6. Publish a downstream contract for script and creation modules: candidate hooks, proof shots, replacement slice ids, risk notes, retrieval keywords, and QA gates.
7. For new video generation, retrieve structured assets first, output a shot-by-shot script, then call image, TTS, or video generation providers.

## Quick Commands

Batch analyze videos, assuming `ARK_API_KEY` is configured:

```powershell
python skills\video-generation-pipeline\scripts\batch_analyze_videos.py --input ".od\asset-library\commerce-videos" --recursive --output-dir ".od\asset-library\analysis\video-storyboard-analysis"
```

Build a pipeline from existing storyboard files:

```powershell
python skills\video-generation-pipeline\scripts\build_pipeline_from_storyboards.py --input ".od\asset-library\analysis\video-storyboard-analysis" --output-dir ".od\asset-library\analysis\video-generation-pipeline"
```

For crawler search-only records, first decide which references are worth downloading into the commerce video library. The pipeline should mark search-only records as low-confidence metadata evidence until `video-storyboard-analysis` has produced slice-level JSON.

## Pipeline Standard

Every generated pipeline must include:

- **Structured asset base**: product dimensions, video dimensions, slice dimensions, embedding text, and downstream consumption contract.
- **Reference base**: source videos, category, confidence, and missing evidence.
- **Technique library**: hook patterns, camera/framing, product proof, movement, scene design, overlay text, audio, CTA.
- **Shot recipe**: 5-8 ordered shots for 9:16 short video, with duration, visual, product proof, caption/voiceover, and generation prompt notes.
- **Provider handoff**: image prompts, video prompts, TTS copy, editing instructions, and asset requirements.
- **QA gates**: product visibility, claim safety, watermark risk, motion coherence, text readability, and platform fit.

## Reference Files

- Read `references/technique-taxonomy.md` before classifying extracted techniques.
- Read `references/structured-asset-contract.md` before designing ingestion, slicing, embedding, or retrieval outputs.
- Read `references/pipeline-template.md` before producing a final generation pipeline.
- Read `references/core-techniques-from-current-videos.md` for the starter patterns extracted from the current workspace videos.

## Common Mistakes

- Do not average videos into vague advice. Extract reusable moves such as "unbox -> label close-up -> use demo -> result shot".
- Do not treat one video as universal. Mark low confidence when fewer than three references support a pattern.
- Do not generate video directly from high-level copy. Build the shot recipe and QA checks first.
- Do not keep watermarks or platform UI as desired style unless the user explicitly wants imitation for internal reference.
- Do not collapse all analysis into a single summary. Script and creation modules need product-level, video-level, and slice-level fields.
