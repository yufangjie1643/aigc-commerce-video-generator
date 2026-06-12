import { describe, expect, it } from 'vitest';

import { getStaticComposioCatalogDefinitions } from '../src/connectors/composio.js';
describe('composio catalog descriptions', () => {
  it('replaces the generic placeholder description with curated copy for known toolkits', () => {
    const catalog = getStaticComposioCatalogDefinitions();
    const github = catalog.find((c) => c.id === 'github');
    expect(github?.description).toBe('Search and inspect GitHub repositories, issues, and pull requests.');
  });

  it('falls back to a neutral description that does not echo the legacy "through Composio" phrasing', () => {
    const catalog = getStaticComposioCatalogDefinitions();
    for (const connector of catalog) {
      // All descriptions should be set and must not use the old
      // uninformative default.
      expect(connector.description).toBeDefined();
      expect(connector.description).not.toMatch(/^Connect to .* through Composio\.$/);
      expect(connector.description).not.toMatch(/integration via Composio/i);
    }
  });

  it('keeps Composio scoped to the GitHub connector', () => {
    const catalog = getStaticComposioCatalogDefinitions();
    expect(catalog.map((connector) => connector.id)).toEqual(['github']);
  });
});
