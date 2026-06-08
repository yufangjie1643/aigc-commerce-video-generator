# Ecommerce Selling Video Reference Library

Use this side file for ecommerce, product selling, 带货, product-demo, product-ad,
offer/CTA, and short-form commerce video projects. Load it before drafting the
first storyboard. Summarize the patterns for the user; do not dump the file.

## Required Gates

Do not call local media generation until all gates are complete:

- `requirement_qa`: product, audience, platform, promise, selling points, proof,
  offer/CTA, style, duration, aspect, and legal/brand constraints are answered or
  explicitly waived by the user.
- `reference_choice`: user picked one reference pattern below, or approved a
  hybrid.
- `asset_manifest`: user uploaded or confirmed product/reference assets, or
  explicitly chose text-to-video with no assets.
- `storyboard_approval`: user approved the final shot list, captions, voiceover,
  required asset per shot, and render settings.
- `generation_plan`: selected model, provider, text-to-video vs image-to-video,
  aspect, duration, output name, and retry policy.

## Asset Manifest

Ask for these assets early. Mark each as `provided`, `missing`, or `not needed`.

- Product hero photo or short product video.
- Packaging, logo, brand colors, SKU/detail shots, and price/offer card.
- Usage or lifestyle shots that show the target scenario.
- Proof assets: review screenshot, certificate, before/after, test data, UGC.
- Reference videos, competitor examples, or style frames.
- Optional audio: voiceover script, music direction, pronunciation notes.

## Image-to-Video Rule

Prefer image-to-video when the user provides a strong product/reference image and
the selected video model supports image input. Pass the image only to models whose
capabilities include image-to-video, for example with `--image <project-relative-path>`.
If a model is text-to-video only, keep the image as visual reference in the prompt
instead of sending it as an input image.

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
