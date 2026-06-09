// @vitest-environment jsdom

// Plugins home section — ecommerce video template UI contract.
//
// The starter shelf keeps the plugin-card runtime and saved/search
// interactions, but its visible information architecture is now the
// product-video workflow: video templates, product assets, storyboard
// motion, and voice/caption presets.

import { describe, expect, it, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { InstalledPluginRecord } from '@open-design/contracts';
import type { ComponentProps } from 'react';
import { PluginsHomeSection } from '../../src/components/PluginsHomeSection';
import { I18nProvider } from '../../src/i18n';

function makePlugin(overrides: {
  id: string;
  title?: string;
  titleI18n?: Record<string, string>;
  description?: string;
  descriptionI18n?: Record<string, string>;
  tags?: string[];
  featured?: boolean;
  mode?: string;
  kind?: 'scenario' | 'atom';
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
      title: overrides.title ?? overrides.id,
      ...(overrides.titleI18n ? { title_i18n: overrides.titleI18n } : {}),
      ...(overrides.description ? { description: overrides.description } : {}),
      ...(overrides.descriptionI18n ? { description_i18n: overrides.descriptionI18n } : {}),
      ...(overrides.tags ? { tags: overrides.tags } : {}),
      od: {
        kind: overrides.kind ?? 'scenario',
        ...(overrides.mode ? { mode: overrides.mode } : {}),
        ...(overrides.featured ? { featured: true } : {}),
      },
    },
    fsPath: '/tmp',
    installedAt: 0,
    updatedAt: 0,
  };
}

function renderSection(
  plugins: InstalledPluginRecord[] = sample,
  props: Partial<ComponentProps<typeof PluginsHomeSection>> = {},
) {
  return render(
    <PluginsHomeSection
      plugins={plugins}
      loading={false}
      activePluginId={null}
      pendingApplyId={null}
      onUse={() => {}}
      onOpenDetails={() => {}}
      {...props}
    />,
  );
}

function renderSectionInChinese(
  plugins: InstalledPluginRecord[] = sample,
  props: Partial<ComponentProps<typeof PluginsHomeSection>> = {},
) {
  return render(
    <I18nProvider initial="zh-CN">
      <PluginsHomeSection
        plugins={plugins}
        loading={false}
        activePluginId={null}
        pendingApplyId={null}
        onUse={() => {}}
        onOpenDetails={() => {}}
        {...props}
      />
    </I18nProvider>,
  );
}

function pluginIds(): Array<string | null> {
  return within(screen.getByRole('list'))
    .getAllByRole('listitem')
    .map((i) => i.getAttribute('data-plugin-id'));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const sample: InstalledPluginRecord[] = [
  makePlugin({ id: 'video-demo', mode: 'video', tags: ['product-promo', 'material-proof'], featured: true }),
  makePlugin({ id: 'video-hook', mode: 'video', tags: ['product-promo', 'viral-hook'] }),
  makePlugin({ id: 'image-sku', mode: 'image', tags: ['product-assets', 'sku'] }),
  makePlugin({ id: 'image-lifestyle', mode: 'image', tags: ['product-assets', 'lifestyle'] }),
  makePlugin({ id: 'hyperframes-storyboard', mode: 'video', tags: ['product-promo', 'storyboard', 'hyperframes', 'shot-list'] }),
  makePlugin({ id: 'audio-voice', mode: 'audio', tags: ['product-promo', 'script', 'voiceover'] }),
  makePlugin({ id: 'hidden-atom', mode: 'video', tags: ['viral-hook'], kind: 'atom' }),
  makePlugin({ id: 'hidden-prototype', mode: 'prototype', tags: ['product-promo'] }),
  makePlugin({ id: 'hidden-deck', mode: 'deck', tags: ['product-promo'] }),
];

describe('PluginsHomeSection (ecommerce video categories)', () => {
  it('frames the home shelf as ecommerce video templates and can jump to the market', () => {
    const onBrowseRegistry = vi.fn();
    renderSection(sample, { onBrowseRegistry });

    expect(screen.getByText('Ecommerce video templates')).toBeTruthy();
    fireEvent.click(screen.getByTestId('plugins-home-browse-registry'));
    expect(onBrowseRegistry).toHaveBeenCalledTimes(1);
  });

  it('renders the video workflow category row and the default Video subcategory row', () => {
    renderSection();

    expect(screen.getByTestId('plugins-home-row-category')).toBeTruthy();
    expect(screen.getByTestId('plugins-home-chip-saved').textContent).toContain('Saved');
    expect(screen.getByTestId('plugins-home-pill-category-all')).toBeTruthy();
    expect(screen.getByTestId('plugins-home-pill-category-video')).toBeTruthy();
    expect(screen.getByTestId('plugins-home-pill-category-image')).toBeTruthy();
    expect(screen.getByTestId('plugins-home-pill-category-hyperframes')).toBeTruthy();
    expect(screen.getByTestId('plugins-home-pill-category-audio')).toBeTruthy();
    expect(screen.queryByTestId('plugins-home-pill-category-prototype')).toBeNull();
    expect(screen.queryByTestId('plugins-home-pill-category-deck')).toBeNull();
    expect(screen.queryByTestId('plugins-home-pill-category-live-artifact')).toBeNull();
    expect(screen.queryByTestId('plugins-home-pill-category-from-figma')).toBeNull();

    expect(screen.getByTestId('plugins-home-row-subcategory-video')).toBeTruthy();
    expect(screen.getByTestId('plugins-home-pill-subcategory-video-video-hooks')).toBeTruthy();
    expect(screen.getByTestId('plugins-home-pill-subcategory-video-video-product-demo')).toBeTruthy();
    expect(screen.getByTestId('plugins-home-pill-subcategory-video-video-platform-shorts')).toBeTruthy();
    expect(screen.getByTestId('plugins-home-pill-subcategory-video-video-reference-breakdown')).toBeTruthy();
  });

  it('filters Video separately from Storyboard motion', () => {
    renderSection();

    expect(screen.getByTestId('plugins-home-pill-category-video').getAttribute('aria-selected')).toBe('true');
    expect(pluginIds().sort()).toEqual(['video-demo', 'video-hook']);
    expect(screen.getByTestId('plugins-home-row-subcategory-video')).toBeTruthy();

    fireEvent.click(screen.getByTestId('plugins-home-pill-category-hyperframes'));
    expect(pluginIds()).toEqual(['hyperframes-storyboard']);
    expect(screen.getByTestId('plugins-home-row-subcategory-hyperframes')).toBeTruthy();
  });

  it('keeps sparse subcategories as real filters without adding contribution cards', () => {
    renderSection();

    fireEvent.click(screen.getByTestId('plugins-home-pill-subcategory-video-video-hooks'));

    expect(pluginIds()).toEqual(['video-hook']);
    expect(screen.queryByTestId('plugins-home-contribution-card')).toBeNull();
    expect(screen.queryByText(/Contribute a/i)).toBeNull();
  });

  it('saves a template, updates the Saved chip, and shows a toast', () => {
    renderSection();

    fireEvent.click(screen.getByTestId('plugins-home-save-video-hook'));

    expect(screen.getByTestId('plugins-home-save-video-hook').textContent).toContain('Saved');
    expect(screen.getByTestId('plugins-home-chip-saved').textContent).toContain('1');
    expect(screen.getByRole('status').textContent).toContain('Saved video-hook.');

    fireEvent.click(screen.getByTestId('plugins-home-chip-saved'));
    expect(pluginIds()).toEqual(['video-hook']);
  });

  it('localizes template card titles, descriptions, search, and save toast', () => {
    renderSectionInChinese([
      makePlugin({
        id: 'localized-video',
        title: 'Skincare Demo Short',
        titleI18n: { en: 'Skincare Demo Short', 'zh-CN': '护肤品卖点短视频' },
        description: 'Material proof and CTA.',
        descriptionI18n: { en: 'Material proof and CTA.', 'zh-CN': '材质证明和行动召唤。' },
        mode: 'video',
        tags: ['product-promo', 'material-proof'],
      }),
    ], { preferDefaultFacet: false });

    expect(screen.getAllByText('护肤品卖点短视频').length).toBeGreaterThan(0);
    expect(screen.queryByText('Skincare Demo Short')).toBeNull();

    fireEvent.change(screen.getByPlaceholderText('搜索任务模板…'), {
      target: { value: '护肤' },
    });
    expect(pluginIds()).toEqual(['localized-video']);

    fireEvent.click(screen.getByTestId('plugins-home-save-localized-video'));
    expect(screen.getByRole('status').textContent).toContain('Saved 护肤品卖点短视频.');
  });

  it('shows the normal empty-filter state for planned empty buckets', () => {
    renderSection();

    fireEvent.click(screen.getByTestId('plugins-home-pill-subcategory-video-video-platform-shorts'));

    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByText(/No templates match the current filters/i)).toBeTruthy();
    expect(screen.queryByTestId('plugins-home-contribution-card')).toBeNull();
  });

  it('shows storyboard motion and voice/caption subcategory rows', () => {
    renderSection();

    fireEvent.click(screen.getByTestId('plugins-home-pill-category-hyperframes'));
    expect(pluginIds()).toEqual(['hyperframes-storyboard']);
    expect(screen.getByTestId('plugins-home-row-subcategory-hyperframes')).toBeTruthy();

    fireEvent.click(screen.getByTestId('plugins-home-pill-category-audio'));
    expect(pluginIds()).toEqual(['audio-voice']);
    expect(screen.getByTestId('plugins-home-row-subcategory-audio')).toBeTruthy();
  });

  it('All pill clears the category filter and only shows ecommerce user-facing templates', () => {
    renderSection();

    fireEvent.click(screen.getByTestId('plugins-home-pill-category-all'));
    expect(pluginIds().sort()).toEqual([
      'audio-voice',
      'hyperframes-storyboard',
      'image-lifestyle',
      'image-sku',
      'video-demo',
      'video-hook',
    ]);
  });

  it('Saved chip overrides the category selection and shows only saved templates', () => {
    renderSection();

    fireEvent.click(screen.getByTestId('plugins-home-save-video-hook'));
    fireEvent.click(screen.getByTestId('plugins-home-pill-category-image'));
    fireEvent.click(screen.getByTestId('plugins-home-chip-saved'));

    expect(pluginIds()).toEqual(['video-hook']);
  });

  it('Clear filters from the Saved empty state escapes Saved mode back to the full catalog', () => {
    renderSection();

    fireEvent.click(screen.getByTestId('plugins-home-chip-saved'));
    expect(screen.queryByRole('list')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Clear filters/i }));

    expect(pluginIds().sort()).toEqual([
      'audio-voice',
      'hyperframes-storyboard',
      'image-lifestyle',
      'image-sku',
      'video-demo',
      'video-hook',
    ]);
  });
});
