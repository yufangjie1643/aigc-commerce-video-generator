---
name: product-image-asset-ingestion
description: |
  Use when Codex needs to organize local ecommerce product image folders into
  project-local commerce-video product materials: recursively find images,
  ignore videos, run image/vision understanding, cluster visually identical
  or same-SKU product photos, submit parsed `productMaterials` with
  `od commerce-video materials --materials-file`, and report project material
  ids, skipped files, and uncertain clusters. Trigger for Chinese requests such as “把这个文件夹里的图片分门别类写入项目商品素材”,
  “分类导入商品图片”, “运行视觉理解，相同商品放到一个门类下”, or “整理服饰鞋包图片素材库”.
triggers:
  - "product image asset ingestion"
  - "商品图片入素材库"
  - "项目商品素材分类导入"
  - "图片分门别类写入项目商品素材"
  - "视觉理解商品聚类"
od:
  mode: utility
  surface: image
  category: marketing-creative
---

# Product Image Asset Ingestion

Turn a local folder tree of ecommerce product images into project-local commerce-video product material records. Default to action. Do not stop to ask about folder structure, video files, model choice, vision provider, cluster granularity, or screenshot pollution handling. Only a truly missing active project id can prevent writing materials.

## Defaults

- Recurse through the supplied directory. Include `jpg`, `jpeg`, `png`, `webp`, and `gif`; ignore videos and unrelated files.
- Treat folder names as weak hints only. The visual pass decides the final group.
- Use this product grouping rule without asking: same visible SKU/style + same dominant color/pattern + same distinguishing details = one product group. Same style in different colors becomes sibling groups under the same family unless the user explicitly asks to merge colors.
- Use Chinese category labels when the user works in Chinese.
- Record every accepted image, not only one representative, so the project material database preserves angles/details.

## Workflow

1. Resolve the current commerce-video project id. Prefer `$OD_PROJECT_ID`; if unavailable, use the active Open Design project context. If no project can be determined, report the missing project context as a runtime wiring issue and stop before writing. Do not ask the user to choose project routing or create/register a replacement project.

2. Recurse through the supplied folder, use real visual understanding for each accepted image when available, and cluster by visible product identity. Prefer the native media CLI before falling back to manifest-only facts. Preferred command shape: `od media understand --image <image-path> --provider mimo --json`.

```powershell
& $env:OD_NODE_BIN $env:OD_BIN media understand `
  --image "<image-path>" `
  --provider mimo `
  --prompt "<analysis instructions>" `
  --json
```

POSIX shell:

```bash
"$OD_NODE_BIN" "$OD_BIN" media understand \
  --image "<image-path>" \
  --provider mimo \
  --prompt "<analysis instructions>" \
  --json
```

MiMo is the default image-understanding provider (`mimo-v2.5`). Do not infer missing image understanding from the absence of a top-level `understanding` config block, and do not use `volcengine-ark` as the image-understanding probe because that provider is video-understanding-only in this app. Do not fake labels from filenames. Missing image-understanding must not block 商品素材上传 when the user already supplied images: continue from the uploaded file manifest plus any image evidence the active model/tool can inspect, mark `analysis.visionProviderMissing: true`, and do not ask for provider credentials.

For each image, extract:

- product type, silhouette, dominant color, material, pattern/print, visible details
- whether it is a main shot, detail shot, model/lifestyle shot, packaging, or duplicate
- a short factual Chinese label
- uncertainty notes

3. Clustering: group by visual identity. Use a stable `clusterId` such as `dress-shirt-blue-001` or a Chinese slug. Keep an `uncertain` cluster when images are too ambiguous; include it only if the user explicitly asked to import everything.

4. Write a JSON file containing one `productMaterials[]` item per visual product group. All records in the same visual product group share the same `category` and `subject`, and `files` contains every accepted angle/detail image for that group:

```json
{
  "productMaterials": [
    {
      "title": "<商品组名>",
      "subject": "<商品主体>",
      "category": "<视觉聚类名>",
      "files": [{ "path": "<absolute-or-project-relative-image-path>", "name": "<file-name>", "mime": "image/jpeg" }],
      "product": {
        "summary": "<只基于可见事实的简述>",
        "sellingPoints": ["<可见卖点1>", "<可见卖点2>"],
        "constraints": ["只基于图片可见事实"],
        "suggestedAngles": ["<适合拍摄/生成的角度>"]
      },
      "analysis": {
        "clusterId": "...",
        "visionText": "<视觉理解原文或摘要>",
        "visionProviderMissing": false
      },
      "metadata": {
        "workflow": "product-image-asset-ingestion",
        "sourceFolder": "<folder>"
      }
    }
  ],
  "uploadedFiles": [{ "path": "<image-path>", "name": "<file-name>", "mime": "image/jpeg" }],
  "notes": "<导入摘要>"
}
```

5. Submit the JSON to the project-local commerce-video materials database:

```powershell
& $env:OD_NODE_BIN $env:OD_BIN commerce-video materials `
  --project $env:OD_PROJECT_ID `
  --materials-file "<materials-json-file>" `
  --json
```

POSIX shell:

```bash
"$OD_NODE_BIN" "$OD_BIN" commerce-video materials \
  --project "$OD_PROJECT_ID" \
  --materials-file "<materials-json-file>" \
  --json
```

Always prefer `--json` and parse returned `productMaterials` ids. Use `--materials-file -` only when stdin piping is reliable.

6. Report succinctly:

- imported image count and project product material ids by cluster
- skipped videos/non-images
- uncertain or low-confidence images
- any provider/config gaps, such as missing image understanding or embedding config, as limitations rather than errors

## When blocked

Most missing details in this workflow have defaults; act instead of asking. Missing visual-provider config is a limitation note for stage one, not a blocker; do not ask about cluster granularity or screenshot pollution handling. Default same visible SKU/style/color/detail to one group and mark UI-heavy screenshots as reference/low-cleanliness material.

Only use the host's interactive choice UI when a required write capability is genuinely missing, such as no active project id or no commerce-video materials command:

- If `AskUserQuestion` is available, call it with 2-4 finite options and stop.
- Otherwise emit one renderable `<question-form>` block with a `radio` question and stop.
- Put the recommended recovery first, for example "restore the active project context and retry".
- Do not duplicate the choices as a markdown table or bullet list before or after the UI surface.

## Guardrails

- Never claim provider-backed visual analysis happened unless an image-understanding tool actually inspected the images; use `visionProviderMissing: true` for conservative manifest-based records.
- Do not ask the user to confirm obvious folder traversal or whether to ignore videos when they already said not to handle videos.
- do not ask about cluster granularity or screenshot pollution handling.
- Do not use `od assets products` or `od assets commerce-videos` for commerce-video product images.
- Do not write to the global product asset library for commerce-video materials; use `od commerce-video materials --materials-file`.
- Do not invent fabric, brand, size, price, or claims that are not visible or supplied.
