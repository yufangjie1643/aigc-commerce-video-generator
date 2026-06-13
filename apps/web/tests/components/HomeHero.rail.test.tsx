// @vitest-environment jsdom
//
// Stage B of plugin-driven-flow-plan — Home intent tabs / shortcuts.
// Covers:
//   - Every chip in the catalog renders with its test id.
//   - Clicking a chip forwards the full chip descriptor to onPickChip
//     so the dispatcher in HomeView can route to the right flow.
//   - The active + pending UI states light up the right chip and
//     disable all chips while a plugin is mid-apply.

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InstalledPluginRecord } from '@open-design/contracts';

import { HomeHero } from '../../src/components/HomeHero';
import {
  HOME_HERO_CHIPS,
  findChip,
} from '../../src/components/home-hero/chips';

afterEach(() => {
  cleanup();
});

function makePlugin(
  id: string,
  mode: string,
  title = id,
  extraTags: string[] = [],
  options: { query?: string | null } = {},
): InstalledPluginRecord {
  return {
    id,
    title,
    version: '1.0.0',
    sourceKind: 'bundled',
    source: '/tmp',
    trust: 'bundled',
    capabilitiesGranted: ['prompt:inject'],
    manifest: {
      name: id,
      version: '1.0.0',
      title,
      description: 'Plugin preset fixture',
      tags: [mode, ...extraTags],
      od: {
        mode,
        useCase: {
          ...(options.query !== null
            ? { query: options.query ?? `Create with {{topic}} using ${title}` }
            : {}),
        },
        inputs: [
          {
            name: 'topic',
            label: 'Topic',
            type: 'text',
            default: 'a focused brief',
          },
        ],
        preview: { type: 'image', poster: '/preview.png' },
      },
    },
    fsPath: '/tmp',
    installedAt: 0,
    updatedAt: 0,
  };
}

function renderHero(overrides: Partial<React.ComponentProps<typeof HomeHero>> = {}) {
  const onPickChip = vi.fn();
  const onPickPlugin = vi.fn();
  const onPickExamplePlugin = vi.fn();
  const onClearActiveChip = vi.fn();
  render(
    <HomeHero
      prompt=""
      onPromptChange={() => undefined}
      onSubmit={() => undefined}
      activePluginTitle={null}
      activeChipId={null}
      onClearActivePlugin={() => undefined}
      pluginOptions={[]}
      pluginsLoading={false}
      pendingPluginId={null}
      pendingChipId={null}
      onPickPlugin={onPickPlugin}
      onPickExamplePlugin={onPickExamplePlugin}
      onPickChip={onPickChip}
      onClearActiveChip={onClearActiveChip}
      contextItemCount={0}
      error={null}
      {...overrides}
    />,
  );
  return { onPickChip, onPickPlugin, onPickExamplePlugin, onClearActiveChip };
}

describe('HomeHero intent rail', () => {
  it('renders creation chips as composer tabs and collapses shortcuts behind More', () => {
    renderHero();
    const tabs = screen.getByTestId('home-hero-type-tabs');
    for (const chip of HOME_HERO_CHIPS) {
      if (chip.group === 'create') {
        const node = screen.getByTestId(`home-hero-rail-${chip.id}`);
        expect(node).toBeTruthy();
        expect(tabs.contains(node)).toBe(true);
      } else {
        expect(screen.queryByTestId(`home-hero-rail-${chip.id}`)).toBeNull();
      }
    }
    fireEvent.click(screen.getByTestId('home-hero-shortcuts-trigger'));
    const menu = screen.getByTestId('home-hero-shortcuts-menu');
    for (const chip of HOME_HERO_CHIPS.filter((item) => item.group === 'migrate')) {
      const node = screen.getByTestId(`home-hero-rail-${chip.id}`);
      expect(node).toBeTruthy();
      expect(menu.contains(node)).toBe(true);
    }
  });

  it('renders execution switcher inside the input footer when provided', () => {
    renderHero({
      executionSwitcher: (
        <button type="button" data-testid="home-execution-switcher">
          Local CLI
        </button>
      ),
    });

    const switcher = screen.getByTestId('home-execution-switcher');
    const footer = switcher.closest('.home-hero__input-foot');
    expect(footer).toBeTruthy();
  });

  it('forwards the matching chip descriptor when clicked', () => {
    const { onPickChip } = renderHero();
    fireEvent.click(screen.getByTestId('home-hero-rail-video-crawler'));
    expect(onPickChip).toHaveBeenCalledTimes(1);
    expect(onPickChip).toHaveBeenCalledWith(findChip('video-crawler'));
  });

  it('moves the active creation chip into the composer and hides the tab row', () => {
    renderHero({ activeChipId: 'video-generation' });
    expect(screen.queryByTestId('home-hero-type-tabs')).toBeNull();
    expect(screen.queryByTestId('home-hero-rail-video-generation')).toBeNull();
    const node = screen.getByTestId('home-hero-active-type-chip');
    expect(node.getAttribute('data-chip-id')).toBe('video-generation');
    expect(node.textContent).toContain('视频生成');
  });

  it('lets the active creation chip be removed from the composer', () => {
    const { onClearActiveChip } = renderHero({ activeChipId: 'video-generation' });
    fireEvent.click(screen.getByTestId('home-hero-active-type-chip'));
    expect(onClearActiveChip).toHaveBeenCalledTimes(1);
  });

  it('uses the active creation chip as the only clear control for a chip-bound plugin', () => {
    const activePlugin = makePlugin('example-image-a', 'image', 'Product image');
    renderHero({
      activeChipId: 'asset-analysis',
      activePluginTitle: 'Product image',
      activePluginRecord: activePlugin,
      showActivePluginChip: true,
    });

    expect(screen.getByTestId('home-hero-active-plugin')).toBeTruthy();
    expect(screen.getByTestId('home-hero-active-type-chip')).toBeTruthy();
    expect(screen.queryByLabelText('Clear active plugin')).toBeNull();
  });

  it('keeps the active plugin clear control when no creation chip is active', () => {
    const activePlugin = makePlugin('example-image-a', 'image', 'Product image');
    const onClearActivePlugin = vi.fn();
    renderHero({
      activeChipId: null,
      activePluginTitle: 'Product image',
      activePluginRecord: activePlugin,
      onClearActivePlugin,
      showActivePluginChip: true,
    });

    const clear = screen.getByLabelText('Clear active plugin');
    fireEvent.click(clear);

    expect(onClearActivePlugin).toHaveBeenCalledTimes(1);
  });

  it('shows prompt examples below the composer for the selected tab', () => {
    const onPromptChange = vi.fn();
    renderHero({ activeChipId: 'video-generation', onPromptChange });

    expect(screen.getByTestId('home-hero-prompt-examples')).toBeTruthy();
    const examples = screen.getAllByTestId('home-hero-prompt-example');
    expect(examples).toHaveLength(2);

    fireEvent.click(examples[0]!);
    expect(onPromptChange).toHaveBeenCalledWith(
      'Generate a <=15s vertical selling video for a portable blender from product input: script, storyboard, TTS/BGM/subtitles, finished preview, and export-ready MP4.',
    );
    // The top "selected example" pill was removed from the composer; picking an
    // example still seeds the prompt but no longer surfaces a dismissible chip.
    expect(screen.queryByTestId('home-hero-active-example')).toBeNull();
  });

  it('keeps workbench task tabs focused on prompt examples rather than plugin presets', () => {
    const videoPlugin = makePlugin('example-video-a', 'video', 'Product video', ['ecommerce']);
    const imagePlugin = makePlugin('example-image-a', 'image', 'Product image');
    renderHero({
      activeChipId: 'video-generation',
      pluginOptions: [videoPlugin, imagePlugin],
    });

    expect(screen.queryByTestId('home-hero-plugin-preset')).toBeNull();
    expect(screen.getAllByTestId('home-hero-prompt-example')).toHaveLength(2);
  });

  it('orders bundled ecommerce presets deterministically for the selected artifact type', () => {
    const ordinaryVideo = makePlugin('example-ordinary-video', 'video', 'Ordinary video', ['ecommerce']);
    const templateVideo = makePlugin(
      'video-template-product-demo',
      'video',
      'Product demo template',
      ['video-template', 'product-demo'],
    );
    renderHero({
      activeChipId: 'video',
      pluginOptions: [ordinaryVideo, templateVideo],
    });

    const presets = screen.getAllByTestId('home-hero-plugin-preset');
    expect(presets.map((preset) => preset.getAttribute('data-plugin-id'))).toEqual([
      'example-ordinary-video',
      'video-template-product-demo',
    ]);
  });

  it('keeps non-commerce curated presets out of the ecommerce prompt area', () => {
    const otakuDance = makePlugin(
      'image-template-infographic-otaku-dance-choreography-breakdown-gokurakujodo-16-panels',
      'image',
      'Infographic - Otaku Dance Choreography Breakdown (Gokuraku Jodo, 16 Panels)',
      ['image-template'],
      { query: null },
    );
    const productAssets = makePlugin(
      'image-template-product-assets',
      'image',
      'Product assets',
      ['image-template', 'product-assets'],
    );
    renderHero({
      activeChipId: 'image',
      pluginOptions: [productAssets, otakuDance],
    });

    const presets = screen.getAllByTestId('home-hero-plugin-preset');
    expect(presets).toHaveLength(1);
    expect(presets[0]?.getAttribute('data-plugin-id')).toBe('image-template-product-assets');
  });

  it('hides Hatch Pet from the image example presets', () => {
    const hatchPet = makePlugin('example-hatch-pet', 'image', 'Hatch Pet');
    const productAssets = makePlugin(
      'image-template-product-assets',
      'image',
      'Product assets',
      ['product-assets'],
    );
    renderHero({
      activeChipId: 'image',
      pluginOptions: [hatchPet, productAssets],
    });

    const presets = screen.getAllByTestId('home-hero-plugin-preset');
    expect(presets.map((preset) => preset.textContent).join(' ')).not.toContain('Hatch Pet');
  });

  it('disables every visible chip while a plugin apply is in flight', () => {
    renderHero({ pendingPluginId: 'od-new-generation', pendingChipId: 'video-generation' });
    for (const chip of HOME_HERO_CHIPS.filter((item) => item.group === 'create')) {
      const node = screen.getByTestId(`home-hero-rail-${chip.id}`);
      expect((node as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.getByTestId('home-hero-rail-video-generation').className).toContain('is-pending');
    const trigger = screen.getByTestId('home-hero-shortcuts-trigger') as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    expect(trigger.className).not.toContain('is-pending');
  });

  it('shows the template library shortcut after More opens', () => {
    renderHero();
    fireEvent.click(screen.getByTestId('home-hero-shortcuts-trigger'));
    const templateGroup = screen
      .getByTestId('home-hero-rail-template')
      .closest('[data-rail-group]');

    expect(templateGroup?.getAttribute('data-rail-group')).toBe('migrate');
    expect(screen.queryByTestId('home-hero-rail-create-plugin')).toBeNull();
    expect(screen.queryByTestId('home-hero-rail-figma')).toBeNull();
    expect(screen.queryByTestId('home-hero-rail-folder')).toBeNull();
  });

  it('keeps the generic fallback in the free-form prompt instead of an Other chip', () => {
    renderHero();

    expect(findChip('other')).toBeUndefined();
    expect(screen.queryByTestId('home-hero-rail-other')).toBeNull();
  });

  it('shortcut chips carry the right action discriminator', () => {
    expect(findChip('create-plugin')).toBeUndefined();
    expect(findChip('figma')).toBeUndefined();
    expect(findChip('folder')).toBeUndefined();
    expect(findChip('template')?.action).toMatchObject({ kind: 'open-template-picker' });
  });

  it('workbench task chips carry seed prompts and route to the expected scenario', () => {
    expect(findChip('video-crawler')?.action).toMatchObject({
      kind: 'apply-scenario',
      pluginId: 'od-new-generation',
      projectKind: 'other',
    });
    expect(findChip('asset-analysis')?.action).toMatchObject({ pluginId: 'od-new-generation', projectKind: 'other' });
    expect(findChip('script-storyboard')?.action).toMatchObject({ pluginId: 'od-new-generation', projectKind: 'other' });
    expect(findChip('video-generation')?.action).toMatchObject({ pluginId: 'od-new-generation', projectKind: 'video' });
    expect(findChip('generation-diagnostics')?.action).toMatchObject({ pluginId: 'od-new-generation', projectKind: 'other' });
    for (const id of ['video-crawler', 'asset-analysis', 'script-storyboard', 'video-generation', 'generation-diagnostics']) {
      expect((findChip(id)?.action as { queryTemplate?: string }).queryTemplate?.length).toBeGreaterThan(20);
    }
  });

  it('removes legacy media-only chips from the visible workbench rail', () => {
    expect(findChip('image')).toBeUndefined();
    expect(findChip('video')).toBeUndefined();
    expect(findChip('audio')).toBeUndefined();
    expect(findChip('hyperframes')).toBeUndefined();
    expect(findChip('live-artifact')).toBeUndefined();
  });
});
