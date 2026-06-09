import { describe, expect, it } from 'vitest';

import {
  appendCommerceStylePrompt,
  commerceStyleDisplayForDesignSystemId,
  commerceStylePromptForDesignSystemId,
} from '../src/prompts/commerce-style.js';

describe('commerce style prompt presets', () => {
  it('defines display copy and prompt meaning for a preset selling style', () => {
    const display = commerceStyleDisplayForDesignSystemId('luxury', 'zh-CN');
    const prompt = commerceStylePromptForDesignSystemId('luxury');

    expect(display?.title).toBe('高端质感');
    expect(prompt).toContain('## Commerce selling style — 高端质感');
    expect(prompt).toContain('premium materials');
  });

  it('appends the selling-style prompt on top of the design-system body', () => {
    const prompt = appendCommerceStylePrompt('xiaohongshu', '# Xiaohongshu\n\nUse soft red accents.');

    expect(prompt).toContain('# Xiaohongshu');
    expect(prompt).toContain('## Commerce selling style — 小红书种草');
    expect(prompt).toContain('credible recommendation note');
  });

  it('leaves non-commerce design systems unchanged', () => {
    const body = '# Clay\n\nFriendly tactile product UI.';

    expect(appendCommerceStylePrompt('clay', body)).toBe(body);
    expect(commerceStylePromptForDesignSystemId('clay')).toBeNull();
  });
});
