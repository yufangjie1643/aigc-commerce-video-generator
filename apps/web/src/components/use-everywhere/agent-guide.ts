// Pure builder for the copied WeChat/internal-agent setup brief.
//
// The blob is the handoff payload for the Use Everywhere panel: paste it into
// a WeChat gateway so incoming questions can be routed through Open Design's
// internal Agent bridge and existing automation status surfaces.
//
// Kept side-effect-free so the unit test can assert the shape (sections
// present, snippets fenced correctly, daemon URL substituted) without
// rendering React.

import { GUIDE_SECTIONS, type CodeSnippet, type GuideSection } from './sections';

export interface AgentGuideOptions {
  /** Live daemon URL detected at modal-open time. Defaults to the documented port. */
  daemonUrl?: string;
  /**
   * Optional `od` binary path / hint. When provided we mention it for bridge
   * hosts that call the live-artifacts CLI while building a reply.
   */
  cliHint?: string;
  /** Optional Open Design version/channel; surfaced in the header for support tickets. */
  versionHint?: string;
}

const DEFAULT_DAEMON_URL = 'http://127.0.0.1:7456';

export function buildAgentGuideMarkdown(options: AgentGuideOptions = {}): string {
  const daemonUrl = (options.daemonUrl ?? DEFAULT_DAEMON_URL).replace(/\/$/, '');
  const lines: string[] = [];

  lines.push('# Open Design — WeChat status bridge');
  lines.push('');
  lines.push(
    'Use Open Design\'s internal Agent bridge for WeChat status questions. The ' +
      'bridge selects an available in-app Agent connection such as OpenCode, ' +
      'then a WeChat gateway can forward messages to the daemon for read-only ' +
      'automation, Orbit, and dashboard status answers.',
  );
  lines.push('');
  lines.push('Start read-only. Add trigger controls later only after the status answers are trusted.');
  if (options.versionHint) {
    lines.push('');
    lines.push(`> Reported Open Design version: \`${options.versionHint}\``);
  }
  lines.push('');

  lines.push('## Bridge checklist');
  lines.push('');
  lines.push('1. Connect the WeChat bridge to an internal Open Design Agent:');
  lines.push('');
  lines.push('   ```bash');
  lines.push(`   curl -s -X POST ${daemonUrl}/api/integrations/wechat/agent/connect | jq`);
  lines.push(`   curl -s ${daemonUrl}/api/integrations/wechat/agent/status | jq`);
  lines.push('   ```');
  lines.push('');
  lines.push('2. Wire the WeChat gateway to forward incoming messages to Open Design:');
  lines.push('');
  lines.push('   ```bash');
  lines.push(`   curl -s ${daemonUrl}/api/routines | jq`);
  lines.push(`   curl -s ${daemonUrl}/api/orbit/status | jq`);
  lines.push('   ```');
  lines.push('');
  lines.push('   Keep WeChat authentication inside the gateway; Open Design only owns the internal Agent bridge.');
  lines.push('');
  lines.push('3. Confirm the Open Design daemon can answer automation status reads:');
  lines.push('');
  lines.push('   ```bash');
  lines.push(`   curl -s ${daemonUrl}/api/routines | jq`);
  lines.push(`   curl -s ${daemonUrl}/api/orbit/status | jq`);
  lines.push('   ```');
  lines.push('');
  lines.push('   If these time out, ask the user to start Open Design first.');
  lines.push('');
  lines.push('4. Map incoming WeChat questions to status reads through the selected Agent:');
  lines.push('');
  lines.push('   ```bash');
  lines.push(`   curl -s ${daemonUrl}/api/routines | jq`);
  lines.push(`   curl -s ${daemonUrl}/api/orbit/status | jq`);
  lines.push('   od tools live-artifacts list --format compact');
  lines.push('   ```');
  if (options.cliHint) {
    lines.push('');
    lines.push(`   The user reported \`od\` at: \`${options.cliHint}\``);
  }
  lines.push('');
  lines.push('5. Reply with concise status, timestamps, and next actions.');
  lines.push('');
  lines.push('   Suggested shape: what is running now, what failed, what is next, and which artifact or dashboard to open.');
  lines.push('');

  for (const section of GUIDE_SECTIONS) {
    lines.push(...renderSection(section, daemonUrl));
  }

  lines.push('## Reference URLs');
  lines.push('');
  lines.push(`- Daemon: \`${daemonUrl}\``);
  lines.push(`- Automation routines: \`${daemonUrl}/api/routines\``);
  lines.push(`- Recent routine runs: \`${daemonUrl}/api/routines/:id/runs?limit=5\``);
  lines.push(`- Orbit status: \`${daemonUrl}/api/orbit/status\``);
  lines.push('- Live dashboards: `od tools live-artifacts list --format compact`');
  lines.push(`- WeChat Agent bridge: \`${daemonUrl}/api/integrations/wechat/agent/status\``);
  lines.push('');
  lines.push(
    '> Open Design does not store WeChat credentials. Keep WeChat auth in the gateway and keep the status bridge read-only until the team explicitly approves WeChat-triggered actions.',
  );
  lines.push('');

  return lines.join('\n');
}

function renderSection(section: GuideSection, daemonUrl: string): string[] {
  const lines: string[] = [];
  lines.push(`## ${substituteDaemonUrl(section.heading, daemonUrl)}`);
  lines.push('');
  lines.push(substituteDaemonUrl(section.intro, daemonUrl));
  lines.push('');
  if (section.bullets.length > 0) {
    for (const bullet of section.bullets) {
      lines.push(`- ${substituteDaemonUrl(bullet, daemonUrl)}`);
    }
    lines.push('');
  }
  for (const snippet of section.snippets) {
    lines.push(...renderSnippet(snippet, daemonUrl));
  }
  if (section.footer) {
    lines.push(`> ${substituteDaemonUrl(section.footer, daemonUrl)}`);
    lines.push('');
  }
  return lines;
}

function renderSnippet(snippet: CodeSnippet, daemonUrl: string): string[] {
  const lines: string[] = [];
  lines.push(`### ${substituteDaemonUrl(snippet.label, daemonUrl)}`);
  lines.push('');
  lines.push('```' + snippet.language);
  lines.push(substituteDaemonUrl(snippet.body, daemonUrl));
  lines.push('```');
  lines.push('');
  return lines;
}

function substituteDaemonUrl(body: string, daemonUrl: string): string {
  return body.replace(/http:\/\/127\.0\.0\.1:7456/g, daemonUrl);
}
