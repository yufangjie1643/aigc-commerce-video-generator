import { describe, expect, it } from 'vitest';

import { createQrSvg } from '../src/qr-code.js';
import { chooseWeChatBridgeAgent } from '../src/routes/wechat-agent.js';
import type { AgentInfo } from '@open-design/contracts';

function agent(input: Partial<AgentInfo> & Pick<AgentInfo, 'id' | 'name'>): AgentInfo {
  return {
    bin: input.id,
    available: false,
    models: [],
    modelsSource: 'fallback',
    ...input,
  };
}

describe('wechat internal agent bridge', () => {
  it('prefers OpenCode when multiple internal agents are available', () => {
    const selected = chooseWeChatBridgeAgent([
      agent({ id: 'codex', name: 'Codex CLI', available: true }),
      agent({ id: 'opencode', name: 'OpenCode', available: true }),
    ]);

    expect(selected?.id).toBe('opencode');
  });

  it('skips agents that still need authentication', () => {
    const selected = chooseWeChatBridgeAgent([
      agent({ id: 'opencode', name: 'OpenCode', available: true, authStatus: 'missing' }),
      agent({ id: 'codex', name: 'Codex CLI', available: true }),
    ]);

    expect(selected?.id).toBe('codex');
  });

  it('returns null when no internal agent is ready', () => {
    expect(
      chooseWeChatBridgeAgent([
        agent({ id: 'opencode', name: 'OpenCode', available: false }),
        agent({ id: 'codex', name: 'Codex CLI', available: true, authStatus: 'missing' }),
      ]),
    ).toBeNull();
  });

  it('generates a QR SVG for the pairing payload', () => {
    const svg = createQrSvg('open-design-wechat:test-token');

    expect(svg).toMatch(/^<svg /);
    expect(svg).toContain('<path fill="#111827"');
    expect(svg).toContain('viewBox="0 0 45 45"');
  });

  it('rejects pairing payloads that do not fit the built-in QR version', () => {
    expect(() => createQrSvg('x'.repeat(140))).toThrow(/QR payload is too long/);
  });
});
