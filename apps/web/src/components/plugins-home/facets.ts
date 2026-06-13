// Facet derivation for the ecommerce video template section.
//
// The starter grid keeps the Open Design plugin runtime underneath, but
// the visible catalog is now organized around the product-video pipeline:
//
//   Video · Product assets · Storyboard motion · Voice / captions
//
// Child buckets follow the ecommerce workflow rather than the old generic
// website / deck taxonomy: hooks, demos, platform shorts, references,
// product visuals, storyboards, captions, and voiceover.
//
// Counts in each category reflect the catalog *as a whole*, not the
// post-filter slice. We deliberately avoid recomputing counts after
// a selection because per-axis counts that "go to zero" as the user
// clicks make the row visually noisy and obscure how the overall
// catalog is shaped.

import { resolveLocalizedText, type InstalledPluginRecord } from '@open-design/contracts';
import { localizedText } from './localization';

export type FacetAxis = 'category' | 'subcategory';

export interface FacetOption {
  slug: string;
  label: string;
  count: number;
  starterPrompt: string;
}

export interface FacetCatalog {
  category: FacetOption[];
  subcategory: Record<string, FacetOption[]>;
}

export interface FacetSelection {
  category: string | null;
  subcategory: string | null;
}

interface CategoryDef {
  slug: string;
  label: string;
  starterPrompt: string;
  test: (record: InstalledPluginRecord) => boolean;
}

interface SubcategoryDef extends CategoryDef {
  parent: string;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
}

function manifestField(record: InstalledPluginRecord, key: string): string | undefined {
  const od = (record.manifest?.od ?? {}) as Record<string, unknown>;
  const v = od[key];
  return typeof v === 'string' ? v : undefined;
}

function manifestTaskKind(record: InstalledPluginRecord): string | undefined {
  return manifestField(record, 'taskKind');
}

function manifestTagSlugs(record: InstalledPluginRecord): string[] {
  const raw = record.manifest?.tags ?? [];
  return raw.map((t) => slugify(String(t))).filter(Boolean);
}

function pipelineAtomSlugs(record: InstalledPluginRecord): string[] {
  const stages = record.manifest?.od?.pipeline?.stages ?? [];
  return stages.flatMap((stage) => stage.atoms.map(slugify));
}

function localizedCommerceValues(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const dict = value as Record<string, unknown>;
  return ['zh-CN', 'zh-TW', 'en']
    .map((locale) => dict[locale])
    .filter((part): part is string => typeof part === 'string');
}

function recordText(record: InstalledPluginRecord): string {
  const od = (record.manifest?.od ?? {}) as Record<string, unknown>;
  const stages = record.manifest?.od?.pipeline?.stages ?? [];
  return [
    record.id,
    record.title,
    record.manifest?.name,
    record.manifest?.title,
    record.manifest?.description,
    ...localizedCommerceValues(record.manifest?.title_i18n),
    ...localizedCommerceValues(record.manifest?.description_i18n),
    ...Object.values(od).filter((value): value is string => typeof value === 'string'),
    ...(record.manifest?.tags ?? []),
    ...stages.flatMap((stage) => stage.atoms),
  ]
    .filter((part): part is string => typeof part === 'string')
    .join(' ')
    .toLowerCase();
}

function recordSlugs(record: InstalledPluginRecord): Set<string> {
  return new Set([
    slugify(record.id),
    slugify(record.manifest?.name ?? ''),
    slugify(record.title ?? ''),
    slugify(manifestTaskKind(record) ?? ''),
    slugify(manifestField(record, 'mode') ?? ''),
    slugify(manifestField(record, 'scenario') ?? ''),
    slugify(manifestField(record, 'surface') ?? ''),
    ...manifestTagSlugs(record),
    ...pipelineAtomSlugs(record),
  ].filter(Boolean));
}

function byMode(mode: string): (record: InstalledPluginRecord) => boolean {
  return (record) => {
    const v = manifestField(record, 'mode');
    return typeof v === 'string' && slugify(v) === mode;
  };
}

function hasAnySlug(record: InstalledPluginRecord, slugs: readonly string[]): boolean {
  const haystack = recordSlugs(record);
  return slugs.some((slug) => haystack.has(slug));
}

function hasAnyText(record: InstalledPluginRecord, needles: readonly string[]): boolean {
  const haystack = recordText(record);
  return needles.some((needle) => haystack.includes(needle));
}

function byAnySlug(...slugs: string[]): (record: InstalledPluginRecord) => boolean {
  return (record) => hasAnySlug(record, slugs);
}

function matchesAny(record: InstalledPluginRecord, tests: Array<(record: InstalledPluginRecord) => boolean>): boolean {
  return tests.some((test) => test(record));
}

const HYPERFRAMES_TESTS = [
  byAnySlug(
    'hyperframes',
    'html-video',
    'video-composition',
    'interactive-video',
  ),
];

function isHyperFramesPlugin(record: InstalledPluginRecord): boolean {
  return matchesAny(record, HYPERFRAMES_TESTS);
}

function isVideoPlugin(record: InstalledPluginRecord): boolean {
  return matchesAny(record, [
    byMode('video'),
    byAnySlug(
      'video',
      'short-form',
      'vertical-video',
      'social-video',
      'website-to-video',
    ),
  ]) && !isHyperFramesPlugin(record);
}

function isImagePlugin(record: InstalledPluginRecord): boolean {
  return matchesAny(record, [
    byMode('image'),
    byAnySlug(
      'image',
      'product-image',
      'product-assets',
      'product-photo',
      'hero-image',
      'visual-assets',
      'lifestyle-image',
    ),
  ]);
}

function isAudioPlugin(record: InstalledPluginRecord): boolean {
  return matchesAny(record, [
    byMode('audio'),
    byAnySlug(
      'audio',
      'voice',
      'voiceover',
      'captions',
      'subtitle',
      'sound-design',
      'sonic-brand',
    ),
  ]);
}

const COMMERCE_TEMPLATE_SLUGS = [
  'ecommerce',
  'commerce',
  'product-assets',
  'product-demo',
  'product-image',
  'product-photo',
  'selling',
  'reference-video',
  'product-promo',
  'platform-preset',
] as const;

const COMMERCE_TEMPLATE_TEXT = [
  '电商',
  '带货',
  '商品',
  '直播',
  '产品宣传片',
  '产品展示',
  '产品海报',
  '种草',
  '卖点',
  '转化',
  '投放',
  '小红书',
  '抖音',
] as const;

const GENERIC_DESIGN_MODES = new Set(['prototype', 'deck', 'live-artifact', 'design-system']);

export function isCommerceVideoTemplate(record: InstalledPluginRecord): boolean {
  const mode = slugify(manifestField(record, 'mode') ?? '');
  if (GENERIC_DESIGN_MODES.has(mode)) return false;
  return hasAnySlug(record, COMMERCE_TEMPLATE_SLUGS) || hasAnyText(record, COMMERCE_TEMPLATE_TEXT);
}

// Curated ecommerce video workflow list. Keep this aligned with the Home
// creation intents and the app's artifact product types.
const PRIMARY_CATEGORIES: readonly CategoryDef[] = [
  {
    slug: 'video',
    label: 'Video',
    starterPrompt: 'Create an ecommerce short-video template for product hooks, proof, benefits, offers, and CTA.',
    test: isVideoPlugin,
  },
  {
    slug: 'image',
    label: 'Product assets',
    starterPrompt: 'Create product image assets for ecommerce video covers, detail shots, lifestyle scenes, and selling points.',
    test: isImagePlugin,
  },
  {
    slug: 'hyperframes',
    label: 'Storyboard motion',
    starterPrompt: 'Create storyboard and motion structure for a vertical ecommerce product video.',
    test: isHyperFramesPlugin,
  },
  {
    slug: 'audio',
    label: 'Voice / captions',
    starterPrompt: 'Create voiceover, caption timing, music, or sonic-brand presets for a product-selling video.',
    test: isAudioPlugin,
  },
];

// Ecommerce workflow child buckets. They are intentionally concise so
// the first screen feels like a production workbench, not a generic
// creative marketplace.
const SUBCATEGORIES: readonly SubcategoryDef[] = [
  {
    parent: 'video',
    slug: 'video-hooks',
    label: 'Hooks',
    starterPrompt: 'Create a 3-second ecommerce video hook that frames the pain point, product promise, and first visual beat.',
    test: byAnySlug(
      'hook',
      'opening-hook',
      'problem-solution',
      'pain-point',
      'product-promise',
      'viral-hook',
    ),
  },
  {
    parent: 'video',
    slug: 'video-product-demo',
    label: 'Product demos',
    starterPrompt: 'Create an ecommerce product demo structure with material proof, use scenario, benefit reveal, offer, and CTA.',
    test: byAnySlug('product-demo', 'product-promo', 'material-proof', 'benefit', 'demo', 'offer', 'cta'),
  },
  {
    parent: 'video',
    slug: 'video-platform-shorts',
    label: 'Platform shorts',
    starterPrompt: 'Create a platform-ready vertical short preset for Douyin, TikTok, Reels, or Xiaohongshu.',
    test: byAnySlug('short-form', 'vertical', 'tiktok', 'douyin', 'reels', 'xhs', 'xiaohongshu', 'social'),
  },
  {
    parent: 'video',
    slug: 'video-reference-breakdown',
    label: 'Reference breakdowns',
    starterPrompt: 'Create a reference-video breakdown template for shot rhythm, captions, transitions, and selling logic.',
    test: byAnySlug('reference', 'reference-video', 'breakdown', 'shot-rhythm', 'selling-logic', 'transition'),
  },
  {
    parent: 'image',
    slug: 'image-product-assets',
    label: 'Product assets',
    starterPrompt: 'Create ecommerce product covers, detail shots, SKU variants, and benefit callouts for video generation.',
    test: byAnySlug('product', 'product-assets', 'product-image', 'product-photo', 'sku', 'detail-shot', 'benefit'),
  },
  {
    parent: 'image',
    slug: 'image-lifestyle-scenes',
    label: 'Lifestyle scenes',
    starterPrompt: 'Create lifestyle scene references that show the product in use with audience, context, and lighting direction.',
    test: byAnySlug('lifestyle', 'use-scenario', 'scene', 'context', 'lighting', 'model'),
  },
  {
    parent: 'image',
    slug: 'image-before-after',
    label: 'Before / after',
    starterPrompt: 'Create before/after visual assets that make the product transformation obvious in the first screen.',
    test: byAnySlug('before-after', 'transformation', 'comparison', 'proof', 'result'),
  },
  {
    parent: 'hyperframes',
    slug: 'hyperframes-storyboards',
    label: 'Storyboards',
    starterPrompt: 'Create shot-by-shot storyboard frames for a vertical ecommerce product video.',
    test: byAnySlug('storyboard', 'shot-list', 'sequence', 'frame-plan', 'shot'),
  },
  {
    parent: 'hyperframes',
    slug: 'hyperframes-captions',
    label: 'Captions',
    starterPrompt: 'Create caption cards, text hierarchy, and on-screen selling points for a product video.',
    test: byAnySlug('caption', 'captions', 'subtitle', 'text-overlay', 'selling-points'),
  },
  {
    parent: 'hyperframes',
    slug: 'hyperframes-transitions',
    label: 'Transitions',
    starterPrompt: 'Create motion transitions and scene timing for product close-ups, proof shots, and CTA frames.',
    test: byAnySlug('transition', 'motion', 'timing', 'close-up', 'cta-frame'),
  },
  {
    parent: 'audio',
    slug: 'audio-voiceover',
    label: 'Voiceover',
    starterPrompt: 'Create a concise ecommerce voiceover script with hook, proof, offer, and CTA beats.',
    test: byAnySlug('voice', 'voiceover', 'narration', 'script', 'spoken'),
  },
  {
    parent: 'audio',
    slug: 'audio-caption-timing',
    label: 'Caption timing',
    starterPrompt: 'Create subtitle timing and beat markers for a short ecommerce video.',
    test: byAnySlug('caption', 'subtitle', 'timing', 'beat', 'karaoke'),
  },
  {
    parent: 'audio',
    slug: 'audio-sonic-brand',
    label: 'Sonic brand',
    starterPrompt: 'Create music, sound-design, and notification accents for a brand-consistent product video.',
    test: byAnySlug('music', 'sound-design', 'sonic-brand', 'jingle', 'audio-logo'),
  },
];

function extractPrimaryCategory(record: InstalledPluginRecord): string | null {
  return PRIMARY_CATEGORIES.find((c) => c.test(record))?.slug ?? null;
}

// Per-plugin category derivation. Returns at most one curated primary
// category, preserving display order.
export function extractCategories(record: InstalledPluginRecord): string[] {
  const primary = extractPrimaryCategory(record);
  return primary ? [primary] : [];
}

export function extractSubcategories(record: InstalledPluginRecord, parent?: string | null): string[] {
  const primary = parent ?? extractPrimaryCategory(record);
  if (!primary) return [];
  const match = SUBCATEGORIES.find((c) => c.parent === primary && c.test(record));
  return match ? [match.slug] : [];
}

export function buildCategoryCatalog(plugins: InstalledPluginRecord[]): FacetOption[] {
  const counts = new Map<string, number>();
  for (const p of plugins) {
    for (const slug of extractCategories(p)) {
      counts.set(slug, (counts.get(slug) ?? 0) + 1);
    }
  }
  return PRIMARY_CATEGORIES.map((c) => ({
    slug: c.slug,
    label: c.label,
    starterPrompt: c.starterPrompt,
    count: counts.get(c.slug) ?? 0,
  }));
}

export function buildSubcategoryCatalog(plugins: InstalledPluginRecord[]): Record<string, FacetOption[]> {
  const counts = new Map<string, number>();
  for (const p of plugins) {
    const parent = extractPrimaryCategory(p);
    if (!parent) continue;
    for (const slug of extractSubcategories(p, parent)) {
      counts.set(`${parent}:${slug}`, (counts.get(`${parent}:${slug}`) ?? 0) + 1);
    }
  }
  return PRIMARY_CATEGORIES.reduce<Record<string, FacetOption[]>>((acc, category) => {
    const options = SUBCATEGORIES.filter((c) => c.parent === category.slug)
      .map((c) => ({
        slug: c.slug,
        label: c.label,
        starterPrompt: c.starterPrompt,
        count: counts.get(`${category.slug}:${c.slug}`) ?? 0,
      }));
    if (options.length > 0) acc[category.slug] = options;
    return acc;
  }, {});
}

export function buildFacetCatalog(plugins: InstalledPluginRecord[]): FacetCatalog {
  return {
    category: buildCategoryCatalog(plugins),
    subcategory: buildSubcategoryCatalog(plugins),
  };
}

export function applyFacetSelection(
  plugins: InstalledPluginRecord[],
  selection: FacetSelection,
): InstalledPluginRecord[] {
  if (!selection.category) return plugins;
  const want = selection.category;
  const inCategory = plugins.filter((p) => extractCategories(p).includes(want));
  if (!selection.subcategory) return inCategory;
  return inCategory.filter((p) => extractSubcategories(p, want).includes(selection.subcategory!));
}

export function isFeaturedPlugin(record: InstalledPluginRecord): boolean {
  const od = (record.manifest?.od ?? {}) as Record<string, unknown>;
  return (
    od.featured === true ||
    (typeof od.featured === 'number' && Number.isFinite(od.featured))
  );
}

// Free-text search across the obvious user-facing surface area: title,
// description, id, and tags. Composed with the category selection via
// AND inside the hook so the search narrows whatever the user has
// already filtered to. Multi-word queries are required to all match
// somewhere in the haystack so phrase fragments like "design slides"
// don't surface unrelated plugins.
export function filterByQuery(
  plugins: InstalledPluginRecord[],
  query: string,
  locale?: string,
): InstalledPluginRecord[] {
  const q = query.trim().toLowerCase();
  if (!q) return plugins;
  const terms = q.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return plugins;
  return plugins.filter((p) => {
    const haystack = [
      p.title ?? '',
      resolveLocalizedText(localizedText(p.manifest?.title_i18n), locale),
      p.id,
      p.manifest?.description ?? '',
      resolveLocalizedText(localizedText(p.manifest?.description_i18n), locale),
      (p.manifest?.tags ?? []).join(' '),
    ]
      .join(' ')
      .toLowerCase();
    return terms.every((t) => haystack.includes(t));
  });
}

// Smart default selection. Lead with the ecommerce video workflow.
export const PREFERRED_DEFAULT_SELECTION: FacetSelection = {
  category: 'video',
  subcategory: null,
};

export function resolveDefaultSelection(catalog: FacetCatalog): FacetSelection {
  const wantCategory = PREFERRED_DEFAULT_SELECTION.category;
  const preferredCategory = wantCategory
    ? catalog.category.find((o) => o.slug === wantCategory && o.count > 0)
    : undefined;
  const selectedCategory = preferredCategory ?? catalog.category.find((o) => o.count > 0);
  if (!selectedCategory) return { category: null, subcategory: null };
  if (selectedCategory.slug !== wantCategory) {
    return { category: selectedCategory.slug, subcategory: null };
  }

  const wantSubcategory = PREFERRED_DEFAULT_SELECTION.subcategory;
  if (!wantSubcategory) return PREFERRED_DEFAULT_SELECTION;

  const hasSubcategoryWithPlugins = catalog.subcategory[wantCategory]?.some(
    (o) => o.slug === wantSubcategory && o.count > 0,
  );
  if (hasSubcategoryWithPlugins) return PREFERRED_DEFAULT_SELECTION;
  return { category: wantCategory, subcategory: null };
}
