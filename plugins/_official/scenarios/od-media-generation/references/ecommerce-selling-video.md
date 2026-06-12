# Ecommerce Selling Video Reference Library

Use this side file for ecommerce, product selling, 带货, product-demo, product-ad,
offer/CTA, and short-form commerce video projects. Load it before drafting the
first storyboard. Summarize the patterns for the user; do not dump the file.

## Staged Chain

When the user wants a finished ecommerce video, move through the full chain as
strict stages. Finish exactly one stage, ask whether to enter the next stage,
and do not run later stages until the user confirms. The stage name 一键成片 is
not permission for full automation; it only creates the generation task.

- `product_source`: image, link, brief, SKU, or library asset.
- `asset_manifest`: product/reference assets marked `provided`, `retrieved`,
  `missing`, or `not needed`.
- `script`: one hook, one selling angle, proof, offer, CTA, and claim-safety
  notes.
- `storyboard`: top-level `shots[]`; 3-6 shots with duration, visual goal, camera/motion, caption,
  voiceover, required asset, generation mode, prompt, and QA check.
- `tts_bgm_subtitles`: final TTS copy, voice/language, BGM or sound-bed
  direction, subtitle/caption lines, and timing.
- `render_settings`: model/provider, text-to-video vs image-to-video, aspect,
  duration, output name, retry path, and preview/export handoff.

Only bypass stage confirmation when the user explicitly says 一键生成视频,
使用一键生成视频的模式, 全自动一键成片, 无需确认, 一次性跑完整流程到导出,
连续执行到最终导出, or equivalent. In that full-auto case, run
`commerce-video generate --follow --full-auto`, then continue to preview/export
before reporting success.
Ecommerce first cuts must be 15 seconds or less; clamp longer metadata to a 15s
first cut unless the user explicitly asks for a longer non-commerce video.

## Asset Manifest

Check these assets early. Mark each as `provided`, `retrieved`, `missing`, or
`not needed`, and keep going with labelled placeholders when the gap is not a
hard blocker.

- Product hero photo or short product video.
- Packaging, logo, brand colors, SKU/detail shots, and price/offer card.
- Usage or lifestyle shots that show the target scenario.
- Proof assets: review screenshot, certificate, before/after, test data, UGC.
- Reference videos, competitor examples, or style frames.
- Optional audio: voiceover script, music direction, pronunciation notes.

## Image-to-Video Rule

The commerce-video CLI does not accept a raw `--image` flag. When the user
explicitly asks to animate a supplied image, use a reference image as first
frame, or names image-to-video / i2v / 图生视频, bind that project file through
storyboard `requiredAssets` and the shot prompt.

## Pattern A: Pain Hook -> Product Solution -> Proof -> Offer

Best for impulse-buy products, household tools, beauty, health, and problem/solution
items.

- 0-2s: Pain hook. Show the frustrating before state; caption names the pain.
- 2-5s: Product enters. One clear action demonstrates the solution.
- 5-9s: Feature proof. Close-up, before/after, data, or user reaction.
- 9-13s: Offer stack. Price, bundle, scarcity, guarantee, or limited benefit.
- 13-15s: CTA. Product hero frame with one action: buy, claim, add to cart.

Storyboard note: keep each shot tied to one selling point. Avoid abstract brand
imagery unless the user asks for a premium product film.

## Pattern B: Premium Product Film -> Texture -> Feature Reveal -> CTA

Best for phone, appliance, cosmetics, fashion, fragrance, luxury packaging, and
brand-launch ads.

- 0-2s: Iconic product silhouette or macro texture.
- 2-5s: Slow hero move with controlled light, reflections, and material detail.
- 5-9s: Feature reveals as visual moments, not bullet slides.
- 9-12s: Lifestyle context or hand interaction to scale the product.
- 12-15s: Final packshot, tagline, price/availability, CTA.

Storyboard note: request product photos and brand assets. Image-to-video is usually
stronger than pure text-to-video for preserving product identity.

## Pattern C: Comparison Test -> Difference -> Decision

Best for products that beat an alternative: cleaning, cookware, gadgets, apparel,
electronics accessories, B2B tools.

- 0-2s: Set the comparison challenge.
- 2-6s: Split-screen or sequential test.
- 6-10s: Quantify or visualize the difference.
- 10-13s: Explain the reason in one feature.
- 13-15s: CTA with confidence cue: guarantee, review count, or stock note.

Storyboard note: ask for competitor constraints and proof assets. Do not invent
claims that need substantiation.

## Pattern D: Scenario Seeding -> Desire -> Product Fit

Best for lifestyle goods, home, travel, outdoor, parenting, pet, food, and gifts.

- 0-3s: Relatable target moment.
- 3-7s: Product naturally solves or upgrades the scene.
- 7-11s: Detail montage: use, texture, scale, convenience.
- 11-14s: Emotional payoff or social proof.
- 14-15s: CTA.

Storyboard note: ask for audience, occasion, and desired emotion before writing
the shot list.

## Pattern E: Live-Commerce Host Script -> Demo -> Deal Push

Best for livestream clips, marketplace short videos, and offer-led ads.

- 0-2s: Host line with direct benefit and who it is for.
- 2-6s: Product demo in hand or on table.
- 6-10s: Two selling points with proof.
- 10-13s: Deal framing: price, bundle, coupon, deadline.
- 13-15s: Direct CTA and urgency.

Storyboard note: ask whether a human host, voiceover only, or subtitle-only format
is desired. If no host footage exists, offer a product-only edit instead of
inventing a spokesperson.
