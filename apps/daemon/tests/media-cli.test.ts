import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('od media CLI', () => {
  it('lists registered media models by surface', () => {
    const cliPath = process.env.OD_DAEMON_CLI_PATH;
    expect(cliPath).toBeTruthy();

    const out = execFileSync(
      process.execPath,
      [cliPath!, 'media', 'models', '--surface', 'video', '--json'],
      { encoding: 'utf8' },
    );
    const parsed = JSON.parse(out);

    expect(parsed.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          surface: 'video',
          id: 'hyperframes-html',
          provider: 'hyperframes',
        }),
      ]),
    );
  });
});
