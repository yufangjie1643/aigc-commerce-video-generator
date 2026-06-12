import { describe, expect, it } from 'vitest';
import type { InstalledPluginRecord } from '@open-design/contracts';
import {
  filterPluginsBySubChip,
  isSubChipParent,
  subChipsForChip,
} from '../src/components/home-hero/sub-chips';

// Minimal record whose facet derivation lands in a known ecommerce-video
// scene. `plugins-home/facets.ts` maps mode + tags into the shared template
// taxonomy used by both the market grid and the Home second-level rail.
function templatePlugin(id: string, mode: string, tags: string[]): InstalledPluginRecord {
  return {
    id,
    title: id,
    manifest: { name: id, od: { mode }, tags },
  } as unknown as InstalledPluginRecord;
}

describe('subChipsForChip', () => {
  it('returns no sub-chips for chips outside the ecommerce video workflow', () => {
    const records = [templatePlugin('video-hook', 'video', ['viral-hook'])];
    expect(subChipsForChip('prototype', records)).toEqual([]);
    expect(subChipsForChip('deck', records)).toEqual([]);
    expect(subChipsForChip('live-artifact', records)).toEqual([]);
    expect(subChipsForChip(null, records)).toEqual([]);
  });

  it('surfaces only video sub-categories that have installed templates, using facet labels', () => {
    const records = [
      templatePlugin('video-hook', 'video', ['viral-hook']),
      templatePlugin('video-demo', 'video', ['material-proof']),
    ];
    const result = subChipsForChip('video', records);
    const slugs = result.map((s) => s.slug);
    expect(slugs).toContain('video-hooks');
    expect(slugs).toContain('video-product-demo');
    // No platform/reference templates installed -> those pills are hidden.
    expect(slugs).not.toContain('video-platform-shorts');
    expect(slugs).not.toContain('video-reference-breakdown');
    const hook = result.find((s) => s.slug === 'video-hooks');
    expect(hook?.label).toBe('Hooks');
  });

  it('returns an empty list when the chip has no installed templates', () => {
    expect(subChipsForChip('video', [])).toEqual([]);
  });

  it('only surfaces pills for sub-categories present in the candidate list it is given', () => {
    const displayed = [templatePlugin('video-demo', 'video', ['material-proof'])];
    const slugs = subChipsForChip('video', displayed).map((s) => s.slug);
    expect(slugs).toEqual(['video-product-demo']);
    expect(slugs).not.toContain('video-hooks');

    for (const slug of slugs) {
      expect(filterPluginsBySubChip(displayed, 'video', slug).length).toBeGreaterThan(0);
    }
  });
});

describe('filterPluginsBySubChip', () => {
  it('narrows a plugin list to the chosen ecommerce sub-category', () => {
    const hook = templatePlugin('video-hook', 'video', ['viral-hook']);
    const demo = templatePlugin('video-demo', 'video', ['material-proof']);
    const result = filterPluginsBySubChip([hook, demo], 'video', 'video-hooks');
    expect(result.map((p) => p.id)).toEqual(['video-hook']);
  });
});

describe('isSubChipParent', () => {
  it('matches the ecommerce video workflow chips', () => {
    expect(isSubChipParent('video')).toBe(true);
    expect(isSubChipParent('image')).toBe(true);
    expect(isSubChipParent('hyperframes')).toBe(true);
    expect(isSubChipParent('audio')).toBe(true);
    expect(isSubChipParent('prototype')).toBe(false);
    expect(isSubChipParent('deck')).toBe(false);
    expect(isSubChipParent(null)).toBe(false);
  });
});
