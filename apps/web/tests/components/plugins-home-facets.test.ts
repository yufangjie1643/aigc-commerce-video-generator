// Facet derivation contract for the ecommerce video template shelf.
// The catalog keeps the plugin runtime underneath, but the visible
// taxonomy is now the product-video workflow:
// Video / Product assets / Storyboard motion / Voice and captions.

import { describe, expect, it } from 'vitest';
import type { InstalledPluginRecord } from '@open-design/contracts';
import {
  applyFacetSelection,
  buildFacetCatalog,
  extractCategories,
  extractSubcategories,
  isCommerceVideoTemplate,
  isFeaturedPlugin,
  resolveDefaultSelection,
} from '../../src/components/plugins-home/facets';

function fixture(overrides: {
  id: string;
  title?: string;
  titleI18n?: Record<string, string>;
  descriptionI18n?: Record<string, string>;
  tags?: string[];
  od?: Record<string, unknown>;
}): InstalledPluginRecord {
  return {
    id: overrides.id,
    title: overrides.title ?? overrides.id,
    version: '0.1.0',
    sourceKind: 'bundled',
    source: '/tmp',
    trust: 'bundled',
    capabilitiesGranted: ['prompt:inject'],
    manifest: {
      name: overrides.id,
      version: '0.1.0',
      ...(overrides.titleI18n ? { title_i18n: overrides.titleI18n } : {}),
      ...(overrides.descriptionI18n ? { description_i18n: overrides.descriptionI18n } : {}),
      ...(overrides.tags ? { tags: overrides.tags } : {}),
      ...(overrides.od ? { od: overrides.od } : {}),
    },
    fsPath: '/tmp',
    installedAt: 0,
    updatedAt: 0,
  };
}

describe('extractCategories', () => {
  it('maps ecommerce generation modes to the video workflow categories', () => {
    expect(extractCategories(fixture({ id: 'video', od: { mode: 'video' } }))).toEqual(['video']);
    expect(extractCategories(fixture({ id: 'image', od: { mode: 'image' } }))).toEqual(['image']);
    expect(extractCategories(fixture({ id: 'hf', tags: ['hyperframes'], od: { mode: 'video' } }))).toEqual([
      'hyperframes',
    ]);
    expect(extractCategories(fixture({ id: 'audio', od: { mode: 'audio' } }))).toEqual(['audio']);
  });

  it('keeps generic Open Design creation surfaces out of the ecommerce template tabs', () => {
    expect(extractCategories(fixture({ id: 'prototype', od: { mode: 'prototype' } }))).toEqual([]);
    expect(extractCategories(fixture({ id: 'deck', od: { mode: 'deck' } }))).toEqual([]);
    expect(extractCategories(fixture({ id: 'live', od: { mode: 'live-artifact' } }))).toEqual([]);
    expect(extractCategories(fixture({ id: 'figma', od: { taskKind: 'figma-migration', mode: 'scenario' } }))).toEqual([]);
    expect(extractCategories(fixture({ id: 'design-system', od: { mode: 'design-system' } }))).toEqual([]);
  });

  it('normalises mode casing and formatting before matching', () => {
    expect(extractCategories(fixture({ id: 'a', od: { mode: 'Video' } }))).toEqual(['video']);
    expect(extractCategories(fixture({ id: 'b', od: { mode: 'product_image' } }))).toEqual(['image']);
    expect(extractCategories(fixture({ id: 'c', od: { mode: 'voiceover' } }))).toEqual(['audio']);
  });
});

describe('extractSubcategories', () => {
  it('maps video templates to ecommerce script and platform buckets', () => {
    expect(extractSubcategories(fixture({ id: 'hook', tags: ['viral-hook'], od: { mode: 'video' } }))).toEqual([
      'video-hooks',
    ]);
    expect(extractSubcategories(fixture({ id: 'demo', tags: ['material-proof'], od: { mode: 'video' } }))).toEqual([
      'video-product-demo',
    ]);
    expect(extractSubcategories(fixture({ id: 'short', tags: ['douyin'], od: { mode: 'video' } }))).toEqual([
      'video-platform-shorts',
    ]);
    expect(extractSubcategories(fixture({ id: 'ref', tags: ['shot-rhythm'], od: { mode: 'video' } }))).toEqual([
      'video-reference-breakdown',
    ]);
  });

  it('maps image templates to product asset buckets', () => {
    expect(extractSubcategories(fixture({ id: 'sku', tags: ['sku'], od: { mode: 'image' } }))).toEqual([
      'image-product-assets',
    ]);
    expect(extractSubcategories(fixture({ id: 'scene', tags: ['lifestyle'], od: { mode: 'image' } }))).toEqual([
      'image-lifestyle-scenes',
    ]);
    expect(extractSubcategories(fixture({ id: 'proof', tags: ['before-after'], od: { mode: 'image' } }))).toEqual([
      'image-before-after',
    ]);
  });

  it('maps storyboard and audio templates to production buckets', () => {
    expect(
      extractSubcategories(fixture({ id: 'storyboard', tags: ['shot-list', 'hyperframes'], od: { mode: 'video' } })),
    ).toEqual(['hyperframes-storyboards']);
    expect(
      extractSubcategories(fixture({ id: 'captions', tags: ['text-overlay', 'hyperframes'], od: { mode: 'video' } })),
    ).toEqual(['hyperframes-captions']);
    expect(
      extractSubcategories(fixture({ id: 'motion', tags: ['cta-frame', 'hyperframes'], od: { mode: 'video' } })),
    ).toEqual(['hyperframes-transitions']);
    expect(extractSubcategories(fixture({ id: 'voice', tags: ['voiceover'], od: { mode: 'audio' } }))).toEqual([
      'audio-voiceover',
    ]);
    expect(extractSubcategories(fixture({ id: 'timing', tags: ['karaoke'], od: { mode: 'audio' } }))).toEqual([
      'audio-caption-timing',
    ]);
    expect(extractSubcategories(fixture({ id: 'sonic', tags: ['jingle'], od: { mode: 'audio' } }))).toEqual([
      'audio-sonic-brand',
    ]);
  });
});

describe('buildFacetCatalog', () => {
  it('produces ecommerce video workflow categories in product order', () => {
    const catalog = buildFacetCatalog([
      fixture({ id: 'video', tags: ['viral-hook'], od: { mode: 'video' } }),
      fixture({ id: 'image', tags: ['sku'], od: { mode: 'image' } }),
      fixture({ id: 'hf', tags: ['hyperframes', 'shot-list'], od: { mode: 'video' } }),
      fixture({ id: 'audio', tags: ['voiceover'], od: { mode: 'audio' } }),
      fixture({ id: 'prototype', od: { mode: 'prototype' } }),
    ]);

    expect(catalog.category.map((o) => [o.slug, o.count])).toEqual([
      ['video', 1],
      ['image', 1],
      ['hyperframes', 1],
      ['audio', 1],
    ]);
    expect((catalog.subcategory.video ?? []).map((o) => o.slug)).toEqual([
      'video-hooks',
      'video-product-demo',
      'video-platform-shorts',
      'video-reference-breakdown',
    ]);
    expect((catalog.subcategory.image ?? []).map((o) => o.slug)).toEqual([
      'image-product-assets',
      'image-lifestyle-scenes',
      'image-before-after',
    ]);
    expect((catalog.subcategory.hyperframes ?? []).map((o) => o.slug)).toEqual([
      'hyperframes-storyboards',
      'hyperframes-captions',
      'hyperframes-transitions',
    ]);
    expect((catalog.subcategory.audio ?? []).map((o) => o.slug)).toEqual([
      'audio-voiceover',
      'audio-caption-timing',
      'audio-sonic-brand',
    ]);
  });
});

describe('applyFacetSelection', () => {
  const plugins = [
    fixture({ id: 'video-hook', tags: ['viral-hook'], od: { mode: 'video' } }),
    fixture({ id: 'video-demo', tags: ['material-proof'], od: { mode: 'video' } }),
    fixture({ id: 'image-sku', tags: ['sku'], od: { mode: 'image' } }),
    fixture({ id: 'hf-storyboard', tags: ['hyperframes', 'shot-list'], od: { mode: 'video' } }),
    fixture({ id: 'audio-voice', tags: ['voiceover'], od: { mode: 'audio' } }),
  ];

  it('returns everything when no category is selected', () => {
    expect(applyFacetSelection(plugins, { category: null, subcategory: null }).map((p) => p.id)).toEqual([
      'video-hook',
      'video-demo',
      'image-sku',
      'hf-storyboard',
      'audio-voice',
    ]);
  });

  it('filters by category and ecommerce subcategory', () => {
    expect(applyFacetSelection(plugins, { category: 'video', subcategory: null }).map((p) => p.id)).toEqual([
      'video-hook',
      'video-demo',
    ]);
    expect(applyFacetSelection(plugins, { category: 'video', subcategory: 'video-hooks' }).map((p) => p.id)).toEqual([
      'video-hook',
    ]);
    expect(applyFacetSelection(plugins, { category: 'hyperframes', subcategory: null }).map((p) => p.id)).toEqual([
      'hf-storyboard',
    ]);
  });
});

describe('isCommerceVideoTemplate', () => {
  it('accepts video workflow records and rejects generic design records', () => {
    expect(isCommerceVideoTemplate(fixture({ id: 'video', od: { mode: 'video' } }))).toBe(false);
    expect(isCommerceVideoTemplate(fixture({ id: 'product-video', tags: ['product-promo'], od: { mode: 'video' } }))).toBe(
      true,
    );
    expect(isCommerceVideoTemplate(fixture({ id: 'cn-video', title: '电商直播带货视频', od: { mode: 'image' } }))).toBe(
      true,
    );
    expect(isCommerceVideoTemplate(fixture({
      id: 'ja-only-product-word',
      descriptionI18n: { ja: '商品写真にも使えます。' },
      od: { mode: 'image' },
    }))).toBe(false);
    expect(isCommerceVideoTemplate(fixture({ id: 'cinematic', tags: ['cinematic'], od: { mode: 'video' } }))).toBe(
      false,
    );
    expect(isCommerceVideoTemplate(fixture({ id: 'template', tags: ['product-promo'], od: { mode: 'template' } }))).toBe(
      true,
    );
    expect(isCommerceVideoTemplate(fixture({ id: 'prototype', tags: ['product-promo'], od: { mode: 'prototype' } }))).toBe(
      false,
    );
    expect(isCommerceVideoTemplate(fixture({ id: 'deck', od: { mode: 'deck' } }))).toBe(false);
  });
});

describe('isFeaturedPlugin', () => {
  it('returns true for boolean featured picks and numeric curator ranks', () => {
    expect(isFeaturedPlugin(fixture({ id: 'a', od: { featured: true } }))).toBe(true);
    expect(isFeaturedPlugin(fixture({ id: 'ranked', od: { featured: 4 } }))).toBe(true);
    expect(isFeaturedPlugin(fixture({ id: 'b', od: { featured: 'true' } }))).toBe(false);
    expect(isFeaturedPlugin(fixture({ id: 'c' }))).toBe(false);
  });
});

describe('resolveDefaultSelection', () => {
  it('defaults the home catalog to Video when that bucket exists', () => {
    const catalog = buildFacetCatalog([
      fixture({ id: 'image', od: { mode: 'image' } }),
      fixture({ id: 'video', od: { mode: 'video' } }),
    ]);

    expect(resolveDefaultSelection(catalog)).toEqual({
      category: 'video',
      subcategory: null,
    });
  });

  it('falls back to the first populated ecommerce workflow bucket when Video is unavailable', () => {
    const catalog = buildFacetCatalog([
      fixture({ id: 'image', od: { mode: 'image' } }),
    ]);

    expect(resolveDefaultSelection(catalog)).toEqual({
      category: 'image',
      subcategory: null,
    });
  });
});
