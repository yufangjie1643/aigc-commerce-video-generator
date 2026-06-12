// Content fixtures for the WeChat status bridge panel.
//
// Kept as a plain data module (no React imports) so the same source feeds both
// the in-app panel and the copied bridge brief in ./agent-guide.ts. The visible
// labels are localized through i18n; this module owns the technical examples.

export interface CodeSnippet {
  /** Tag shown above the snippet in the UI. */
  label: string;
  /** Optional language hint (used for syntax highlighting + markdown). */
  language: 'bash' | 'json' | 'http' | 'yaml' | 'ts' | 'tsx' | 'text';
  /** Source body. Multi-line allowed; do not include leading/trailing blank lines. */
  body: string;
}

export interface GuideSection {
  /** Stable id used as the React tab key. */
  id: 'overview';
  /** Short tab label. */
  tabLabel: string;
  /** Section heading inside the body. */
  heading: string;
  /** One-paragraph intro under the heading. */
  intro: string;
  /** Bulleted highlights - short value props the user should grasp first. */
  bullets: string[];
  /** Ordered snippets that a WeChat gateway can copy into its own flow. */
  snippets: CodeSnippet[];
  /**
   * Optional follow-up footer. Plain text - the UI renders it muted, the
   * markdown blob inlines it as a `>` callout.
   */
  footer?: string;
}

export const GUIDE_SECTIONS: GuideSection[] = [
  {
    id: 'overview',
    tabLabel: 'WeChat',
    heading: 'Connect WeChat to an internal Agent, then ask automation status',
    intro:
      'Bind the WeChat status bridge to an Open Design internal Agent such ' +
      'as OpenCode. A WeChat gateway can then forward incoming questions to ' +
      'the daemon, where the selected Agent reads automation status and ' +
      'answers in the chat where the team already asks for updates.',
    bullets: [
      'Use Open Design\'s existing Agent connections first; no extra channel CLI is required.',
      'After scanning, ask "what is running now?" and get queued, running, succeeded, failed, and canceled routine runs.',
      'Ask whether today\'s Orbit digest finished, when the next digest is scheduled, and where the live artifact landed.',
      'Ask for live dashboard freshness before a standup, review, or release check.',
      'Keep WeChat as a read-only status surface first; trigger controls can be added after the bridge is trusted.',
    ],
    snippets: [
      {
        label: 'Connect the internal Agent bridge',
        language: 'bash',
        body:
          'DAEMON_URL=${DAEMON_URL:-http://127.0.0.1:7456}\n' +
          'curl -s -X POST "$DAEMON_URL/api/integrations/wechat/agent/connect" | jq\n' +
          'curl -s "$DAEMON_URL/api/integrations/wechat/agent/status" | jq',
      },
      {
        label: 'Open Design status reads',
        language: 'bash',
        body:
          'DAEMON_URL=${DAEMON_URL:-http://127.0.0.1:7456}\n' +
          'curl -s "$DAEMON_URL/api/routines" | jq\n' +
          'curl -s "$DAEMON_URL/api/orbit/status" | jq\n' +
          'od tools live-artifacts list --format compact',
      },
      {
        label: 'WeChat questions and reply shape',
        language: 'json',
        body:
          '{\n' +
          '  "wechatQuestions": [\n' +
          '    "What automations are running now?",\n' +
          '    "Did today\'s Orbit digest finish?",\n' +
          '    "When is the next scheduled agent session?",\n' +
          '    "Which live dashboards are stale?"\n' +
          '  ],\n' +
          '  "reply": "Orbit finished at 09:02. 2 automations are scheduled in the next hour. Candidate dashboard last refreshed 14 minutes ago.",\n' +
          '  "actions": ["Open Orbit artifact", "View failed routine", "Refresh live dashboard"]\n' +
          '}',
      },
    ],
    footer:
      'Open Design does not store WeChat credentials here. The WeChat gateway ' +
      'owns WeChat auth; Open Design only exposes an internal Agent bridge and ' +
      'read-only status surfaces.',
  },
];
