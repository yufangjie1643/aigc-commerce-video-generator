// @vitest-environment jsdom

// Plan G4 — MarketplaceView jsdom smoke.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MarketplaceView } from '../../src/components/MarketplaceView';

const PLUGIN_ROW = {
  id: 'product-video-template',
  title: 'Product Video Template',
  version: '1.0.0',
  trust: 'restricted' as const,
  sourceKind: 'local' as const,
  source: '/tmp/product-video',
  manifest: {
    description: 'A fixture',
    od: { mode: 'video' },
    tags: ['product-promo'],
  },
};

const MARKETPLACE_ROW = {
  id: 'mp-1',
  url: 'https://example.com/marketplace.json',
  trust: 'restricted',
  manifest: {
    name: 'Example marketplace',
    plugins: [{ name: 'product-video-template', source: 'github:open-design/product-video-template' }],
  },
};

const OPEN_DESIGN_MARKETPLACE_ROW = {
  id: 'open-design-official',
  url: 'https://raw.githubusercontent.com/nexu-io/open-design/main/plugins/registry/official/open-design-marketplace.json',
  trust: 'official',
  manifest: {
    name: 'open-design-official',
    plugins: [],
  },
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (url) => {
    if (url === '/api/plugins') {
      return new Response(JSON.stringify({ plugins: [PLUGIN_ROW] }), { status: 200 });
    }
    if (url === '/api/marketplaces') {
      return new Response(JSON.stringify({ marketplaces: [MARKETPLACE_ROW, OPEN_DESIGN_MARKETPLACE_ROW] }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('MarketplaceView', () => {
  it('renders the installed plugins as cards and the configured catalogs', async () => {
    render(<MarketplaceView />);
    await waitFor(() => screen.getByTestId('marketplace-grid'));
    expect(screen.getByText('Product Video Template')).toBeTruthy();
    expect(screen.getByText('A fixture')).toBeTruthy();
    expect(screen.getByText('Example marketplace')).toBeTruthy();
    expect(screen.getByText('Official template source')).toBeTruthy();
    expect(screen.queryByText(/open-design-official/)).toBeNull();
    expect(screen.getByText(/1 template\(s\)/)).toBeTruthy();
  });

  it('filters by trust tier when the user clicks Trusted', async () => {
    render(<MarketplaceView />);
    await waitFor(() => screen.getByText('Product Video Template'));
    const trustedFilter = screen.getByText('Trusted', { selector: 'button' });
    trustedFilter.click();
    await waitFor(() => expect(screen.queryByText('Product Video Template')).toBeNull());
    expect(
      screen.getByText(/No ecommerce video templates are installed yet/, { exact: false }),
    ).toBeTruthy();
  });
});
