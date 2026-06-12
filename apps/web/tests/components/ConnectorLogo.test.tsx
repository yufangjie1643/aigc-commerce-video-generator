import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ConnectorLogo } from '../../src/components/ConnectorLogo';

describe('ConnectorLogo', () => {
  it('uses bundled site-specific marks for video crawler connectors', () => {
    const douyin = renderToStaticMarkup(
      <ConnectorLogo
        connector={{
          id: 'douyin',
          name: 'Douyin',
          provider: 'Video crawler',
          category: 'Video',
          status: 'available',
          tools: [],
        }}
        theme="light"
      />,
    );
    const bilibili = renderToStaticMarkup(
      <ConnectorLogo
        connector={{
          id: 'bilibili',
          name: 'Bilibili',
          provider: 'Video crawler',
          category: 'Video',
          status: 'available',
          tools: [],
        }}
        theme="dark"
      />,
    );

    expect(douyin).toContain('src="/connector-icons/douyin.svg"');
    expect(bilibili).toContain('src="/connector-icons/bilibili.svg"');
    expect(douyin).not.toContain('/api/connectors/logos/douyin');
    expect(bilibili).not.toContain('/api/connectors/logos/bilibili');
  });
});
