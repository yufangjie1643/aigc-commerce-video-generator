// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { HostEditor, HostEditorsResponse } from '@open-design/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HandoffButton } from '../../src/components/HandoffButton';
import { I18nProvider, type Locale } from '../../src/i18n';
import { readExpandedIndexCss } from '../helpers/read-expanded-css';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

function stubEditors(editors: HostEditor[], platform: HostEditorsResponse['platform'] = 'darwin') {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input) => {
    if (String(input) === '/api/editors') {
      return new Response(JSON.stringify({ editors, platform }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (String(input) === '/api/projects/project-1/open-in') {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch ${String(input)}`);
  }));
}

function renderLocalized(locale: Locale) {
  render(
    <I18nProvider initial={locale}>
      <HandoffButton projectId="project-1" />
    </I18nProvider>,
  );
}

describe('HandoffButton i18n', () => {
  it('keeps the header trigger as an icon-sized solo control', () => {
    const css = readExpandedIndexCss();

    expect(css).toContain('.app .handoff-trigger');
    expect(css).toContain('width: 32px;');
    expect(css).toContain('height: 30px;');
    expect(css).toContain('.app .handoff-trigger--solo');
  });

  it('localizes the file-manager label', async () => {
    stubEditors([{ id: 'finder', label: 'Finder', available: true }]);

    renderLocalized('en');

    const trigger = await screen.findByTestId('handoff-trigger');
    expect(trigger.getAttribute('title')).toBe('Show in file manager');
    expect(trigger.querySelector('.handoff-trigger-label')?.textContent).toBe('Show in file manager');
  });

  it('opens only the platform file manager even when editors are detected', async () => {
    stubEditors([
      { id: 'cursor', label: 'Cursor', available: true },
      { id: 'finder', label: 'Finder', available: true },
    ]);

    renderLocalized('en');

    fireEvent.click(await screen.findByTestId('handoff-trigger'));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/editors');
      expect(fetch).toHaveBeenCalledWith('/api/projects/project-1/open-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ editorId: 'finder' }),
      });
    });
    expect(screen.queryByTestId('handoff-caret')).toBeNull();
    expect(screen.queryByTestId('handoff-menu')).toBeNull();
  });

  it('uses the localized Chinese label', async () => {
    stubEditors([
      { id: 'finder', label: 'Finder', available: true },
      { id: 'cursor', label: 'Cursor', available: false },
    ]);

    renderLocalized('zh-CN');

    const trigger = await screen.findByTestId('handoff-trigger');
    expect(trigger.textContent).toContain('在文件管理器中显示');
  });
});
