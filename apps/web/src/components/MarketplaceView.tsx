// Ecommerce video template marketplace.
//
// Lists installed workflow templates as a card grid while preserving the
// Open Design marketplace plumbing underneath. Configured marketplaces are
// rendered as secondary template sources so first-step product trim changes
// the visible surface without deleting the runtime.

import { useEffect, useState } from 'react';
import type { InstalledPluginRecord } from '@open-design/contracts';
import { listPlugins } from '../state/projects';
import { navigate } from '../router';
import { useI18n } from '../i18n';
import { isCommerceVideoTemplate } from './plugins-home/facets';
import { localizePluginDescription, localizePluginTitle } from './plugins-home/localization';

interface Marketplace {
  id: string;
  url: string;
  trust: 'official' | 'trusted' | 'restricted';
  manifest: { name?: string; plugins?: Array<{ name: string; source: string; description?: string }> };
}

export function MarketplaceView() {
  const { locale, t } = useI18n();
  const [plugins, setPlugins] = useState<InstalledPluginRecord[]>([]);
  const [marketplaces, setMarketplaces] = useState<Marketplace[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'trusted' | 'restricted'>('all');

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      listPlugins(),
      fetch('/api/marketplaces')
        .then((r) => (r.ok ? r.json() : { marketplaces: [] }))
        .then((d) => (d?.marketplaces ?? []) as Marketplace[]),
    ]).then(([rows, mps]) => {
      if (cancelled) return;
      setPlugins(rows);
      setMarketplaces(mps);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = plugins.filter(
    (p) => isCommerceVideoTemplate(p) && (filter === 'all' || p.trust === filter),
  );

  return (
    <div className="marketplace-view" data-testid="marketplace-view">
      <header className="marketplace-view__header">
        <h1>{t('marketplace.title')}</h1>
        <div className="marketplace-view__filters">
          <button
            type="button"
            data-active={filter === 'all'}
            onClick={() => setFilter('all')}
          >
            {t('marketplace.filterAll')}
          </button>
          <button
            type="button"
            data-active={filter === 'trusted'}
            onClick={() => setFilter('trusted')}
          >
            {t('marketplace.filterTrusted')}
          </button>
          <button
            type="button"
            data-active={filter === 'restricted'}
            onClick={() => setFilter('restricted')}
          >
            {t('marketplace.filterRestricted')}
          </button>
        </div>
      </header>

      {loading ? (
        <div className="marketplace-view__loading">{t('marketplace.loading')}</div>
      ) : null}

      <section className="marketplace-view__grid" data-testid="marketplace-grid">
        {visible.length === 0 && !loading ? (
          <div className="marketplace-view__empty">
            {t('marketplace.empty')}
          </div>
        ) : null}
        {visible.map((p) => (
          <button
            type="button"
            key={p.id}
            className="marketplace-view__card"
            onClick={() => navigate({ kind: 'marketplace-detail', pluginId: p.id })}
            data-plugin-id={p.id}
          >
            <div className="marketplace-view__card-title">{localizePluginTitle(locale, p)}</div>
            {localizePluginDescription(locale, p) ? (
              <div className="marketplace-view__card-desc">{localizePluginDescription(locale, p)}</div>
            ) : null}
            <div className="marketplace-view__card-meta">
              <span>v{p.version}</span>
              <span>{t('marketplace.trustLabel')}: {p.trust}</span>
              <span>{p.sourceKind}</span>
            </div>
          </button>
        ))}
      </section>

      <section className="marketplace-view__catalogs" data-testid="marketplace-catalogs">
        <h2>{t('marketplace.sourcesTitle')}</h2>
        {marketplaces.length === 0 ? (
          <div>{t('marketplace.sourcesEmpty')}</div>
        ) : (
          <ul>
            {marketplaces.map((m) => (
              <li key={m.id}>
                <strong>{marketplaceSourceLabel(m, t)}</strong>{' '}
                <span className="marketplace-view__catalog-trust">{t('marketplace.trustLabel')}: {m.trust}</span>
                {' · '}
                {t('marketplace.templateCount', { count: m.manifest.plugins?.length ?? 0 })}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function marketplaceSourceLabel(marketplace: Marketplace, t: ReturnType<typeof useI18n>['t']): string {
  const raw = [
    marketplace.id,
    marketplace.url,
    marketplace.manifest.name,
  ].join(' ').toLowerCase();
  if (raw.includes('open-design') || raw.includes('nexu-io/open-design')) {
    return marketplace.trust === 'official'
      ? t('marketplace.sourceOfficial')
      : t('marketplace.sourceTeam');
  }
  return marketplace.manifest.name ?? (
    marketplace.trust === 'official'
      ? t('marketplace.sourceOfficial')
      : t('marketplace.sourceTeam')
  );
}
