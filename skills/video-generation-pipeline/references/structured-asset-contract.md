# Structured Asset Contract

Use this contract when turning ingested videos into assets that script and creation modules can consume.

## Granularity

| Level | Purpose | Required Fields |
| --- | --- | --- |
| Product dimensions | Identify what product/material the asset can support | `subject`, `category`, `product_role`, `usage_scene`, `target_audience`, `selling_point_candidates`, `claim_constraints` |
| Video dimensions | Recall and reason about the whole media item | `overall_summary`, `embedding_text`, `style_tags`, `hook_type`, `cta_type`, `pacing`, `bgm_or_sound`, `platform_fit` |
| Slice dimensions | Select fine-grained material for scripts, replacements, and edits | `sequence`, `start_ms`, `end_ms`, `slice_type`, `summary`, `detected_objects`, `ocr_text`, `visual_features`, `usage_context`, `script_role`, `quality_score`, `embedding_text` |
| Downstream contract | Make the asset safe to consume | `asset_granularity`, `recommended_consumers`, `retrieval_keywords`, `copyright_policy`, `safety_notes` |

## Project Alignment

Use existing repository concepts when available:

- Asset record: `asset_type`, `title`, `description`, `category`, `keywords`, `source`, `license`, `provenance.structured_analysis`, `embedding_status`.
- File record: `asset_id`, `storage_key`, `mime_type`, `duration_ms`, `fps`, `codec`, `url`.
- Slice record: `slice_type`, `sequence`, `start_ms`, `end_ms`, `summary`, `detected_objects`, `ocr_text`, `visual_features`, `usage_context`, `quality_score`.
- Embedding record: video-level `embedding_scope` such as `doubao_video_summary`; slice-level embedding text can be derived from the slice summary, detected objects, OCR, and usage context.
- Retrieval package: expose granularity `["asset", "asset_file", "asset_slice"]` and include `product_dimensions`, `media_summaries`, and `slice_features`.

## Embedding Text Rules

- Video embedding text should combine overall summary, category, subject, selling points, hook, style, CTA, and safety constraints.
- Slice embedding text should combine timestamp, summary, detected objects, OCR, visual features, usage context, and script role.
- Do not include API keys, signed URLs, raw Base64 payloads, or long provider responses.

## Consumer Mapping

| Consumer | Needs |
| --- | --- |
| Script generation | product dimensions, selling point candidates, hook patterns, risk notes, proof slices |
| Creation edit plan | slice ids, start/end time, summary, visual features, quality score, usage context |
| Video generation | shot recipe, prompt notes, product constraints, motion constraints |
| Search/retrieval | video and slice embedding text, category, keywords, OCR, detected objects |

