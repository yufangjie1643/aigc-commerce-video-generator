import { describe, expect, it } from 'vitest';

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
});
