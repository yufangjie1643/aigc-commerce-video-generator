import { describe, expect, it } from 'vitest';
import {
  HOME_PROMPT_EXAMPLE_CHIP_IDS,
  homeHeroChipPromptExamplesForLocale,
} from '../../src/components/HomeHero';
import { LOCALES } from '../../src/i18n/types';

describe('home hero prompt examples localization', () => {
  it('resolves two ecommerce example prompts for every chip in every supported locale', () => {
    for (const locale of LOCALES) {
      for (const chipId of HOME_PROMPT_EXAMPLE_CHIP_IDS) {
        const examples = homeHeroChipPromptExamplesForLocale(chipId, locale);
        expect(examples, `${locale}/${chipId}`).toHaveLength(2);
        for (const example of examples) {
          expect(example.trim().length, `${locale}/${chipId} non-empty`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('uses Chinese source prompts for zh-CN and English copies for the other locales', () => {
    for (const locale of LOCALES) {
      for (const chipId of HOME_PROMPT_EXAMPLE_CHIP_IDS) {
        const localized = homeHeroChipPromptExamplesForLocale(chipId, locale);
        const english = homeHeroChipPromptExamplesForLocale(chipId, 'en');
        if (locale === 'zh-CN') {
          expect(localized, `${locale}/${chipId} should use Chinese source copy`).not.toEqual(english);
        } else {
          expect(localized, `${locale}/${chipId} should copy the English baseline`).toEqual(english);
        }
      }
    }
  });
});
