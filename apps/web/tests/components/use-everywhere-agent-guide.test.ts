import { describe, expect, it } from 'vitest';

import { buildAgentGuideMarkdown } from '../../src/components/use-everywhere/agent-guide';
import { GUIDE_SECTIONS } from '../../src/components/use-everywhere/sections';

describe('buildAgentGuideMarkdown', () => {
  it('emits a top-level header and the setup checklist by default', () => {
    const md = buildAgentGuideMarkdown();
    expect(md).toMatch(/^# Open Design — WeChat status bridge/);
    expect(md).toContain('## Bridge checklist');
    expect(md).toContain('/api/integrations/wechat/agent/connect');
    expect(md).toContain('/api/integrations/wechat/agent/status');
    expect(md).toContain('http://127.0.0.1:7456/api/routines');
    expect(md).toContain('http://127.0.0.1:7456/api/orbit/status');
    expect(md).not.toContain('/api/mcp/install-info');
    expect(md).not.toContain('openclaw');
  });

  it('substitutes the daemonUrl into every default snippet URL', () => {
    const md = buildAgentGuideMarkdown({ daemonUrl: 'http://localhost:9999' });
    expect(md).toContain('http://localhost:9999/api/routines');
    expect(md).toContain('http://localhost:9999/api/orbit/status');
    expect(md).not.toContain('http://127.0.0.1:7456');
  });

  it('strips a trailing slash on the daemonUrl so URLs do not double up', () => {
    const md = buildAgentGuideMarkdown({ daemonUrl: 'http://example.test:1234/' });
    expect(md).toContain('http://example.test:1234/api/routines');
    expect(md).not.toContain('http://example.test:1234//api/routines');
  });

  it('includes every guide section heading', () => {
    const md = buildAgentGuideMarkdown();
    for (const section of GUIDE_SECTIONS) {
      expect(md).toContain(`## ${section.heading}`);
    }
  });

  it('renders fenced code blocks that match each snippet language', () => {
    const md = buildAgentGuideMarkdown();
    const fenceCount = (md.match(/```/g) ?? []).length;
    expect(fenceCount % 2).toBe(0);
    expect(fenceCount).toBeGreaterThan(GUIDE_SECTIONS.length * 2);
    expect(md).toContain('```bash');
    expect(md).toContain('```json');
    expect(md).not.toContain('```yaml');
  });

  it('documents the WeChat automation status surfaces', () => {
    const md = buildAgentGuideMarkdown();
    expect(md).toContain('internal Agent bridge');
    expect(md).toContain('OpenCode');
    expect(md).toContain('next scheduled agent session');
    expect(md).toContain('/api/routines');
    expect(md).toContain('/api/orbit/status');
    expect(md).toContain('od tools live-artifacts list --format compact');
    expect(md).not.toContain('od project create');
    expect(md).not.toContain('od run start');
  });

  it('surfaces version and CLI hints in the checklist when supplied', () => {
    const md = buildAgentGuideMarkdown({
      versionHint: '0.42.0',
      cliHint: '/usr/local/bin/od',
    });
    expect(md).toContain('Reported Open Design version: `0.42.0`');
    expect(md).toContain('The user reported `od` at: `/usr/local/bin/od`');
  });

  it('omits hint sentences when the corresponding option is not provided', () => {
    const md = buildAgentGuideMarkdown();
    expect(md).not.toContain('Reported Open Design version');
    expect(md).not.toContain('The user reported `od` at');
  });

  it('always closes with a Reference URLs section', () => {
    const md = buildAgentGuideMarkdown({ daemonUrl: 'http://example.test:5555' });
    expect(md).toContain('## Reference URLs');
    expect(md).toContain('- Daemon: `http://example.test:5555`');
    expect(md).toContain('- Automation routines: `http://example.test:5555/api/routines`');
    expect(md).toContain('- Orbit status: `http://example.test:5555/api/orbit/status`');
    expect(md).toContain(
      '- WeChat Agent bridge: `http://example.test:5555/api/integrations/wechat/agent/status`',
    );
    expect(md).not.toContain('MCP install info');
  });
});
