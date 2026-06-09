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
          id: 'doubao-seedance-1.5-pro',
          provider: 'volcengine',
          default: true,
        }),
        expect.objectContaining({
          surface: 'video',
          id: 'minimax-video-01',
          provider: 'minimax',
          caps: expect.arrayContaining(['i2v']),
        }),
        expect.objectContaining({
          surface: 'video',
          id: 'hyperframes-html',
          provider: 'hyperframes',
        }),
      ]),
    );

    const defaultVideoModels = parsed.models.filter((model: { default?: boolean }) => model.default === true);
    expect(defaultVideoModels.map((model: { id: string }) => model.id)).toEqual(['doubao-seedance-1.5-pro']);
    expect(parsed.models.map((model: { id: string }) => model.id)).not.toContain('doubao-seedance-2-0-260128');
  });
});
