---
name: video-storyboard-analysis
description: Use when Codex needs to analyze local or URL video assets from the product asset library or commerce video library into timestamped storyboard scripts, shot breakdowns, product/category dimensions, video summaries, embedding text, slice-level multimodal features, OCR cues, visual style notes, reuse suggestions, or structured JSON/Markdown deliverables using Volcengine Ark video understanding.
triggers:
  - "素材库视频分析"
  - "带货视频分镜解析"
  - "视频切片理解"
  - "video storyboard analysis"
  - "commerce video asset analysis"
  - "multimodal video understanding"
od:
  mode: utility
  category: video-generation
  surface: video
  asset_library:
    sections:
      - commerce-videos
      - products
    outputs:
      - product_dimensions
      - video_dimensions
      - slice_dimensions
      - embedding_text
      - storyboard_script
  capabilities_required:
    - local_file_read
    - network
    - file_write
---

# Video Storyboard Analysis

## Overview

Turn product videos into reusable structured assets and storyboard scripts. Prefer the bundled script for local files because it handles Ark auth, Base64 data URLs, prompt structure, JSON extraction, and Markdown export consistently.

## Quick Start

Run from the repository root:

```powershell
python skills/video-storyboard-analysis/scripts/analyze_video_storyboard.py --video "path\to\video.mp4"
```

For Open Design asset-library analysis output:

```powershell
python skills\video-storyboard-analysis\scripts\analyze_video_storyboard.py --video ".od\asset-library\commerce-videos\<asset-id>\original.mp4" --output-dir ".od\asset-library\analysis\video-storyboard-analysis"
```

The script reads `ARK_API_KEY` from the environment or the project `.env`. Never place API keys in the skill, command examples, output JSON, or Markdown reports.

When starting from crawler search results, first download/import the selected source video into the commerce video library with `od assets commerce-videos import-crawler`, then run this skill on the stored local file path. Search-only records can still be summarized, but slice-level multimodal analysis requires an actual video file or public video URL.

## Workflow

1. Verify the video exists and note size. Use Base64 data URL for local videos under 50 MB; use a public URL or Ark Files API for larger assets.
2. Use Volcengine Ark Chat API with `messages[].content[]` containing a `video_url` block and a text prompt.
3. Set `fps` deliberately. Start with `1.0` for short ecommerce videos; increase up to `2.0` only when motion or fast cuts need more temporal detail.
4. Ask for one JSON object with `metadata`, `asset_contract`, `overall_summary`, `selling_points`, `shot_breakdown`, `storyboard_script`, `editing_notes`, `reuse_recommendations`, and `risk_notes`.
5. In `asset_contract`, require product dimensions, video dimensions, slice dimensions, embedding text, and downstream consumption hints.
6. Save both raw JSON and a readable Markdown storyboard. If JSON parsing fails, preserve the raw model text next to the report for manual recovery.
7. Validate that every slice has a timestamp/range, summary, detected objects, OCR text, visual features, usage context, quality score, and reuse guidance before presenting it.

## Script Options

Use `--help` for the full list. Common options:

| Option | Use |
| --- | --- |
| `--video` | Local file path or remote video URL. |
| `--output-dir` | Destination for JSON and Markdown reports. |
| `--model` | Ark model or endpoint ID; defaults to `ARK_VIDEO_STORYBOARD_MODEL`, `ARK_VIDEO_MODEL`, then `doubao-seed-2-0-lite-260215`. |
| `--fps` | Sampling rate passed to Ark video understanding. |
| `--category` | Product category context for better ecommerce interpretation. |
| `--language` | Output language, default `zh-CN`. |

## Output Standard

Storyboard reports should be useful for an ecommerce AIGC production pipeline and asset library:

- **Product dimensions**: subject/product, category, product role, scene, audience, selling point candidates, claim constraints.
- **Video dimensions**: overall summary, platform/style, hook, CTA, pacing, BGM, visual style, `embedding_text` for vector recall.
- **Slice dimensions**: sequence, start/end time, summary, detected objects, OCR text, visual features, usage context, quality score, and script-generation role.
- **Shot breakdown**: sequence, start/end time, camera/framing, subject/action, visual details, OCR text, audio/copy cue, purpose, reuse notes.
- **Script**: timestamped narration or on-screen copy, including hook, body selling points, transition logic, and CTA.
- **Style**: pacing, lighting, color, composition, platform conventions, music/sound assumptions.
- **Risks**: blurry frames, watermark/logo, misleading claims, unsafe content, missing product evidence.

## References

Read `references/volcengine-ark-video-understanding.md` when changing request shape, size limits, model defaults, or sampling behavior.
