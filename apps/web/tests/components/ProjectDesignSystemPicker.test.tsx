// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DesignSystemSummary } from '../../src/types';

vi.mock('../../src/providers/registry', () => ({
  fetchDesignSystemPreview: vi.fn(),
}));

import { ProjectDesignSystemPicker } from '../../src/components/ProjectDesignSystemPicker';
import { I18nProvider, type Locale } from '../../src/i18n';
import { fetchDesignSystemPreview } from '../../src/providers/registry';

const fetchDesignSystemPreviewMock = vi.mocked(fetchDesignSystemPreview);

const designSystems: DesignSystemSummary[] = [
  {
    id: 'clay',
    title: 'Clay',
    summary: 'Friendly tactile product UI.',
    category: 'Product',
    swatches: ['#f4efe7', '#25211d'],
  },
  {
    id: 'xiaohongshu',
    title: 'Xiaohongshu',
    summary: 'Social commerce notes.',
    category: 'Media & Consumer',
    swatches: ['#ff2442', '#fff5f7'],
  },
  {
    id: 'luxury',
    title: 'Luxury',
    summary: 'Premium dark commerce.',
    category: 'Professional & Corporate',
    swatches: ['#12100c', '#c8a15a'],
  },
  {
    id: 'energetic',
    title: 'Energetic',
    summary: 'High-impact promotional UI.',
    category: 'Expressive',
    swatches: ['#ff4d00', '#ffe600'],
  },
  {
    id: 'minimal',
    title: 'Minimal',
    summary: 'Clear white product shelf.',
    category: 'Utility',
    swatches: ['#ffffff', '#111827'],
  },
  {
    id: 'neon',
    title: 'Neon',
    summary: 'Dark neon launch UI.',
    category: 'Trend',
    swatches: ['#09090f', '#00f5ff'],
  },
  {
    id: 'cafe',
    title: 'Cafe',
    summary: 'Warm lifestyle commerce.',
    category: 'Lifestyle',
    swatches: ['#f4e7d3', '#8b4a2f'],
  },
];

beforeEach(() => {
  fetchDesignSystemPreviewMock.mockResolvedValue('<html><body><h1>Preview</h1></body></html>');
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ProjectDesignSystemPicker', () => {
  function renderPicker(
    props: Partial<ComponentProps<typeof ProjectDesignSystemPicker>> = {},
    locale: Locale = 'zh-CN',
  ) {
    return render(
      <I18nProvider initial={locale}>
        <ProjectDesignSystemPicker designSystems={designSystems} selectedId="luxury" onChange={vi.fn()} {...props} />
      </I18nProvider>,
    );
  }

  it('checks the active commerce style and previews it by default', async () => {
    renderPicker();

    fireEvent.click(screen.getByTestId('project-ds-picker-trigger'));

    expect(screen.getAllByText('高端质感').length).toBeGreaterThan(0);
    expect(screen.queryByText('Clay')).toBeNull();

    const activeOption = await screen.findByTestId('project-ds-picker-option-luxury');
    expect(activeOption.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('project-ds-picker-option-luxury-check')).toBeTruthy();

    await waitFor(() => {
      expect(fetchDesignSystemPreviewMock).toHaveBeenCalledWith('luxury');
    });
    expect(await screen.findByTestId('project-ds-picker-preview-frame')).toBeTruthy();
  });

  it('updates the preview target on hover and opens the fullscreen preview', async () => {
    renderPicker();

    fireEvent.click(screen.getByTestId('project-ds-picker-trigger'));
    await screen.findByTestId('project-ds-picker-preview-frame');

    fireEvent.mouseEnter(screen.getByTestId('project-ds-picker-option-xiaohongshu'));
    await waitFor(() => {
      expect(fetchDesignSystemPreviewMock).toHaveBeenCalledWith('xiaohongshu');
    });

    fireEvent.click(await screen.findByTestId('project-ds-picker-preview-expand'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getAllByText('小红书种草').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByLabelText('关闭全屏预览'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('selects a commerce style option with keyboard activation', async () => {
    const onChange = vi.fn();
    renderPicker({ onChange });

    fireEvent.click(screen.getByTestId('project-ds-picker-trigger'));
    const option = await screen.findByTestId('project-ds-picker-option-xiaohongshu');
    option.focus();
    fireEvent.keyDown(option, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('xiaohongshu');
  });

  it('selects the no-commerce-style option with keyboard activation', async () => {
    const onChange = vi.fn();
    renderPicker({ onChange });

    fireEvent.click(screen.getByTestId('project-ds-picker-trigger'));
    const option = (await screen.findAllByRole('option'))[0];
    if (!option) throw new Error('Expected the no-design-system option to render');
    option.focus();
    fireEvent.keyDown(option, { key: ' ' });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('uses commerce style picker copy', async () => {
    renderPicker();

    fireEvent.click(screen.getByTestId('project-ds-picker-trigger'));

    expect(screen.getByPlaceholderText('搜索带货风格')).toBeTruthy();
    expect(screen.getByText('不套用带货风格')).toBeTruthy();
  });
});
