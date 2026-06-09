---
name: product-image-asset-ingestion
description: |
  Use when Codex needs to organize local ecommerce product image folders into
  the Open Design product asset library: recursively find images, ignore
  videos, run image/vision understanding, cluster visually identical or
  same-SKU product photos, import product images with `od assets products
  import-image`, and report imported asset ids, skipped files, and uncertain
  clusters. Trigger for Chinese requests such as “把这个文件夹里的图片分门别类加入商品素材库”,
  “分类导入商品图片”, “运行视觉理解，相同商品放到一个门类下”, or “整理服饰鞋包图片素材库”.
triggers:
  - "product image asset ingestion"
  - "商品图片入素材库"
  - "商品素材库分类导入"
  - "图片分门别类加入商品素材库"
  - "视觉理解商品聚类"
od:
  mode: utility
  surface: image
  category: marketing-creative
---

# Product Image Asset Ingestion

Turn a local folder tree of ecommerce product images into product asset-library records. Default to action. Do not stop to ask about folder structure, video files, model choice, or cluster granularity unless a required tool is missing.

## Defaults

- Recurse through the supplied directory. Include `jpg`, `jpeg`, `png`, `webp`, and `gif`; ignore videos and unrelated files.
- Treat folder names as weak hints only. The visual pass decides the final group.
- Use this product grouping rule without asking: same visible SKU/style + same dominant color/pattern + same distinguishing details = one product group. Same style in different colors becomes sibling groups under the same family unless the user explicitly asks to merge colors.
- Use Chinese category labels when the user works in Chinese.
- Import every accepted image, not only one representative, so the library preserves angles/details.

## Workflow

1. Inventory the directory:

```powershell
python skills\product-image-asset-ingestion\scripts\inventory_product_images.py --root "<folder>" --output ".od\asset-library\analysis\product-image-ingestion"
```

Read `manifest.json`. If there are zero images, report that and stop. If videos exist, mention they were skipped.

2. Run visual understanding for each image using the best available image-understanding capability in the environment, such as MiniMax MCP `understand_image`, model-native image input, or a configured image understanding endpoint. Do not fake labels from filenames. If no image-understanding tool is available, give the manifest path and ask the user to enable an image understanding provider.

For each image, extract:

- product type, silhouette, dominant color, material, pattern/print, visible details
- whether it is a main shot, detail shot, model/lifestyle shot, packaging, or duplicate
- a short factual Chinese label
- uncertainty notes

3. Cluster images by visual identity. Use a stable `clusterId` such as `dress-shirt-blue-001` or a Chinese slug. Keep an `uncertain` cluster when images are too ambiguous; import it only if the user explicitly asked to import everything.

4. Import with the product asset CLI, one image per record, all records in the same visual product group sharing the same `category` and `subject`:

```powershell
pnpm exec od assets products import-image "<absolute-image-path>" `
  --title "<商品组名>-<序号>" `
  --subject "<商品主体>" `
  --category "<视觉聚类名>" `
  --selling-points "<可见卖点1>,<可见卖点2>" `
  --metadata-json '{"workflow":"product-image-asset-ingestion","clusterId":"...","sourceFolder":"...","vision":{...}}' `
  --wait --json
```

Use `"$OD_NODE_BIN" "$OD_BIN"` instead of `pnpm exec od` when those env vars exist inside an agent run. Always prefer `--json` and parse returned product ids.

5. Verify the import:

```powershell
pnpm exec od assets products list --query "<cluster or subject>" --json
```

6. Report succinctly:

- imported image count and product asset ids by cluster
- skipped videos/non-images
- uncertain or low-confidence images
- any provider/config gaps, such as missing image understanding or embedding config

## When blocked

Most missing details in this workflow have defaults; act instead of asking. If a required capability is genuinely missing, such as no image-understanding tool or no product-image import command, use the host's interactive choice UI rather than a markdown A/B/C table:

- If `AskUserQuestion` is available, call it with 2-4 finite options and stop.
- Otherwise emit one renderable `<question-form>` block with a `radio` question and stop.
- Put the recommended recovery first, for example "enable/configure vision and continue".
- Do not duplicate the choices as a markdown table or bullet list before or after the UI surface.

## Guardrails

- Never claim visual analysis happened unless an image-understanding tool actually inspected the images.
- Do not ask the user to confirm obvious folder traversal or whether to ignore videos when they already said not to handle videos.
- Do not use `od assets commerce-videos` for product images.
- Do not invent fabric, brand, size, price, or claims that are not visible or supplied.
