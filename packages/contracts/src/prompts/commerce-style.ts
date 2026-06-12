export type CommerceStyleLocaleKey = 'zh' | 'en';

export interface CommerceStylePresetDisplay {
  title: string;
  summary: string;
  category: string;
}

export interface CommerceStylePreset {
  id: string;
  display: Record<CommerceStyleLocaleKey, CommerceStylePresetDisplay>;
  swatches: string[];
  prompt: string;
}

export const COMMERCE_STYLE_PROMPT_MARKER = '## Commerce selling style';

export const COMMERCE_STYLE_PRESETS: CommerceStylePreset[] = [
  {
    id: 'xiaohongshu',
    display: {
      zh: {
        title: '小红书种草',
        summary: '适合美妆、穿搭、生活方式商品，强调真实体验、柔和卡片和笔记感氛围。',
        category: '内容种草',
      },
      en: {
        title: 'Xiaohongshu Seeding',
        summary: 'For beauty, fashion, and lifestyle products with authentic notes, soft cards, and social proof.',
        category: 'Content commerce',
      },
    },
    swatches: ['#ff2442', '#fff6f8', '#1f1f1f'],
    prompt: `## Commerce selling style — 小红书种草

Treat this as the selling-style layer on top of the active DESIGN.md.
- Position the page like a credible recommendation note, not a generic store page.
- Lead with real-use context, personal discovery, before/after value, and "why I recommend it" proof.
- Use soft cards, airy screenshots, notebook-like annotations, warm social proof, tag chips, and practical scene photos.
- Copy should feel close, specific, and experience-based. Avoid loud hard-sell banners unless the user asks for a promotion campaign.
- Make the buying path visible but secondary: product value, usage moment, trust signal, then CTA.`,
  },
  {
    id: 'energetic',
    display: {
      zh: {
        title: '爆款促销',
        summary: '适合限时折扣、直播间秒杀和强转化活动，使用高能色块、醒目价格和密集利益点。',
        category: '强促转化',
      },
      en: {
        title: 'Flash-Sale Hype',
        summary:
          'For live-sale drops and limited discounts with high-energy blocks, loud prices, and dense benefit claims.',
        category: 'Conversion',
      },
    },
    swatches: ['#ff4d00', '#ffe600', '#111111'],
    prompt: `## Commerce selling style — 爆款促销

Treat this as the selling-style layer on top of the active DESIGN.md.
- Optimize for fast conversion: clear price anchor, main discount, scarcity cue, benefit stack, and one dominant CTA.
- Use energetic color blocking, strong typographic hierarchy, countdown/limited-stock modules, and quick comparison strips.
- Bring the most persuasive commercial claims above the fold: saved money, bundle value, urgency, guarantees, and shipping perks.
- Keep the layout dense but controlled. Every module should answer "why buy now?" without becoming visually chaotic.
- Copy can be punchy and promotional, but avoid fake claims or pressure that the user did not specify.`,
  },
  {
    id: 'luxury',
    display: {
      zh: {
        title: '高端质感',
        summary: '适合珠宝、香氛、酒类和高客单商品，用深色画布、金色细节和克制留白建立溢价感。',
        category: '高客单',
      },
      en: {
        title: 'Premium Luxury',
        summary:
          'For jewelry, fragrance, wine, and high-ticket products using dark surfaces, gold detail, and restrained whitespace.',
        category: 'High ticket',
      },
    },
    swatches: ['#12100c', '#c8a15a', '#f6efe3'],
    prompt: `## Commerce selling style — 高端质感

Treat this as the selling-style layer on top of the active DESIGN.md.
- Build desire through restraint: one strong hero product, premium materials, provenance, craft, ritual, and sensory detail.
- Prefer deep surfaces, refined neutrals, precise spacing, elegant serif/accent type when available, and subtle metallic highlights.
- Replace discount-led language with value-led language: collection, limited edition, origin story, craftsmanship, service, gifting.
- Use fewer CTAs and more confidence cues: certification, concierge, reviews from credible buyers, secure checkout, delivery care.
- Avoid crowded promo blocks, cheap gradients, fake luxury wording, or shouting price unless the user explicitly wants a sale moment.`,
  },
  {
    id: 'minimal',
    display: {
      zh: {
        title: '清爽白底',
        summary: '适合日用百货、数码配件和功能型商品，突出卖点参数、对比信息和干净购买路径。',
        category: '清爽理性',
      },
      en: {
        title: 'Clean White Shelf',
        summary:
          'For daily goods, accessories, and functional products with clear specs, comparisons, and a clean buying path.',
        category: 'Clean utility',
      },
    },
    swatches: ['#ffffff', '#111827', '#2f80ed'],
    prompt: `## Commerce selling style — 清爽白底

Treat this as the selling-style layer on top of the active DESIGN.md.
- Make the product easy to understand: clear hero, concise benefit bullets, specs, variants, compatibility, and comparison tables.
- Use a white or very light shelf, disciplined spacing, clean product imagery, quiet dividers, and highly legible body text.
- Prioritize rational purchase confidence: what it does, who it fits, how it compares, what's included, delivery/return details.
- CTAs should be obvious and calm. Avoid decorative overload, heavy atmosphere, or lifestyle copy that hides core product facts.
- Good default structure: hero, benefits, use cases, comparison, details, reviews, checkout CTA.`,
  },
  {
    id: 'neon',
    display: {
      zh: {
        title: '夜场科技',
        summary: '适合潮玩、数码、游戏外设和新品首发，使用暗色背景、霓虹光效和强节奏视觉。',
        category: '潮流科技',
      },
      en: {
        title: 'Neon Tech Drop',
        summary: 'For gadgets, toys, gaming gear, and launches with dark canvases, neon glow, and strong visual rhythm.',
        category: 'Trend tech',
      },
    },
    swatches: ['#09090f', '#00f5ff', '#ff2bd6'],
    prompt: `## Commerce selling style — 夜场科技

Treat this as the selling-style layer on top of the active DESIGN.md.
- Frame the product like a launch, drop, or performance upgrade with a dark stage and high-contrast neon accents.
- Use specs, benchmark-style facts, product close-ups, motion-like bands, glowing outlines, and modular feature cards.
- Copy should feel sharp and future-facing: speed, precision, immersion, exclusivity, first access, limited drop, power.
- Keep contrast readable. Neon is an accent system, not a reason to bury text in glow or low-contrast gradients.
- The CTA can be bold, but still pair it with concrete specs, compatibility, warranty, and launch timing.`,
  },
  {
    id: 'cafe',
    display: {
      zh: {
        title: '生活方式',
        summary: '适合食品、咖啡、家居和礼盒商品，整体更温暖、自然，强调场景感和日常陪伴。',
        category: '温暖日常',
      },
      en: {
        title: 'Warm Lifestyle',
        summary:
          'For food, coffee, home goods, and gift boxes with warm scenes, natural textures, and everyday companionship.',
        category: 'Lifestyle',
      },
    },
    swatches: ['#f4e7d3', '#8b4a2f', '#2f241f'],
    prompt: `## Commerce selling style — 生活方式

Treat this as the selling-style layer on top of the active DESIGN.md.
- Sell through scenes and rituals: morning routine, dinner table, small gift, home corner, travel companion, or shared moment.
- Use warm natural textures, relaxed photography, editorial sections, softer CTAs, and sensory copy around taste, touch, scent, comfort.
- Highlight everyday companionship and giftability instead of raw discount mechanics.
- Trust cues should feel human: ingredients/materials, origin, care instructions, reviews, packaging, delivery freshness.
- Keep the page calm, inviting, and product-specific. Avoid generic cozy decoration that does not explain why this item matters.`,
  },
];

const COMMERCE_STYLE_PRESET_BY_ID = new Map(COMMERCE_STYLE_PRESETS.map((preset) => [preset.id, preset]));

export function commerceStyleLocaleKey(locale: string | null | undefined): CommerceStyleLocaleKey {
  return typeof locale === 'string' && locale.startsWith('zh') ? 'zh' : 'en';
}

export function commerceStylePresetForDesignSystemId(
  designSystemId: string | null | undefined,
): CommerceStylePreset | null {
  if (typeof designSystemId !== 'string' || designSystemId.length === 0) return null;
  return COMMERCE_STYLE_PRESET_BY_ID.get(designSystemId) ?? null;
}

export function commerceStyleDisplayForLocale(
  preset: CommerceStylePreset,
  locale: string | null | undefined,
): CommerceStylePresetDisplay {
  return preset.display[commerceStyleLocaleKey(locale)];
}

export function commerceStyleDisplayForDesignSystemId(
  designSystemId: string | null | undefined,
  locale: string | null | undefined,
): CommerceStylePresetDisplay | null {
  const preset = commerceStylePresetForDesignSystemId(designSystemId);
  return preset ? commerceStyleDisplayForLocale(preset, locale) : null;
}

export function commerceStylePromptForDesignSystemId(designSystemId: string | null | undefined): string | null {
  return commerceStylePresetForDesignSystemId(designSystemId)?.prompt ?? null;
}

export function appendCommerceStylePrompt(
  designSystemId: string | null | undefined,
  designSystemBody: string | null | undefined,
): string | undefined {
  if (typeof designSystemBody !== 'string' || designSystemBody.trim().length === 0) return undefined;
  const prompt = commerceStylePromptForDesignSystemId(designSystemId);
  if (!prompt) return designSystemBody;

  const body = designSystemBody.trimEnd();
  if (body.includes(COMMERCE_STYLE_PROMPT_MARKER)) return body;
  return `${body}\n\n---\n\n${prompt.trim()}`;
}
