// Second-level "sub-type" rail for the Home input card.
//
// After a first-level create chip is picked (Video / Product assets /
// Storyboard motion / Voice and captions), this rail surfaces a compact row
// of sub-categories that match the ecommerce template grid.
//
// The list is NOT hand-authored here: it is derived from the same
// `SUBCATEGORIES` facet table the template section uses
// (`plugins-home/facets.ts`), so the labels and grouping stay in lockstep.
// Picking a sub-type filters the example-prompt cards below the rail to that
// scene; it does NOT bind a plugin or stamp an active badge.

import type { InstalledPluginRecord } from '@open-design/contracts';
import type { IconName } from '../Icon';
import {
  buildSubcategoryCatalog,
  extractSubcategories,
  type FacetOption,
} from '../plugins-home/facets';

// Parent chips that carry a second-level rail.
export type SubChipParentId = 'video' | 'image' | 'hyperframes' | 'audio';

export interface HomeHeroSubChip {
  // Facet subcategory slug, e.g. 'video-hooks'.
  slug: string;
  label: string;
  icon: IconName;
}

const PARENT_IDS: readonly SubChipParentId[] = ['video', 'image', 'hyperframes', 'audio'];

// Icon per facet subcategory slug. Falls back to a neutral glyph so a newly
// added facet still renders a pill rather than crashing.
const SUBCATEGORY_ICONS: Record<string, IconName> = {
  'video-hooks': 'sparkles',
  'video-product-demo': 'play',
  'video-platform-shorts': 'play',
  'video-reference-breakdown': 'search',
  'image-product-assets': 'image',
  'image-lifestyle-scenes': 'image',
  'image-before-after': 'grid',
  'hyperframes-storyboards': 'grid',
  'hyperframes-captions': 'comment',
  'hyperframes-transitions': 'palette',
  'audio-voiceover': 'mic',
  'audio-caption-timing': 'history',
  'audio-sonic-brand': 'volume',
};
const DEFAULT_SUBCATEGORY_ICON: IconName = 'blocks';

// Home-rail display order overrides. Slugs listed here float to the front (in
// this order); everything else keeps the Community facet order behind them.
// Kept local so it doesn't perturb the Community section's ordering.
const SUBCATEGORY_PRIORITY: Partial<Record<SubChipParentId, readonly string[]>> = {
  video: ['video-hooks', 'video-product-demo'],
  image: ['image-product-assets'],
  hyperframes: ['hyperframes-storyboards'],
  audio: ['audio-voiceover'],
};

function orderSubcategories(
  parent: SubChipParentId,
  options: readonly FacetOption[],
): FacetOption[] {
  const priority = SUBCATEGORY_PRIORITY[parent];
  if (!priority || priority.length === 0) return [...options];
  const rank = (slug: string) => {
    const index = priority.indexOf(slug);
    return index === -1 ? priority.length : index;
  };
  return [...options].sort((a, b) => rank(a.slug) - rank(b.slug));
}

export function isSubChipParent(chipId: string | null): chipId is SubChipParentId {
  return (
    chipId === 'video' ||
    chipId === 'image' ||
    chipId === 'hyperframes' ||
    chipId === 'audio'
  );
}

// Sub-types for a first-level chip, drawn from the template facet catalog so
// the labels match exactly. Only sub-categories that actually have installed
// plugins (count > 0) are surfaced, preserving the facet display order.
// Returns [] for chips without a second-level rail.
export function subChipsForChip(
  chipId: string | null,
  plugins: InstalledPluginRecord[],
): HomeHeroSubChip[] {
  if (!isSubChipParent(chipId)) return [];
  const catalog = buildSubcategoryCatalog(plugins);
  const options: FacetOption[] = catalog[chipId] ?? [];
  return orderSubcategories(chipId, options.filter((option) => option.count > 0))
    .map((option) => ({
      slug: option.slug,
      label: option.label,
      icon: SUBCATEGORY_ICONS[option.slug] ?? DEFAULT_SUBCATEGORY_ICON,
    }));
}

// Narrow a list of example-prompt plugins to a chosen sub-category. The
// `parent` chip id scopes which facet subcategory table is consulted.
export function filterPluginsBySubChip(
  plugins: InstalledPluginRecord[],
  parent: SubChipParentId,
  subcategorySlug: string,
): InstalledPluginRecord[] {
  return plugins.filter((plugin) =>
    extractSubcategories(plugin, parent).includes(subcategorySlug),
  );
}

export { PARENT_IDS };
