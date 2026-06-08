// Stage B of plugin-driven-flow-plan — Home intent rail.
//
// The Home input card sits naked above an unstructured prompt. New
// users frequently type a request without knowing which scenario
// plugin to apply, which lands them in the generic agent path and
// stretches the convergence loop. This chip rail exposes high-signal
// NewProjectModal categories plus a small set of lower-row shortcuts
// (plugin authoring / Figma / template), so the same Enter
// keystroke can hit a scenario-bound run. The generic "other" path stays
// in the free-form prompt instead of becoming a redundant chip.
//
// The catalog stays a pure data table:
//   - `id` — stable React key + test selector.
//   - `label` — English copy. Localisation can layer on later by
//     swapping this for a Dict lookup; keeping it inline lets the
//     rail ship without burning through 17 locale files for two
//     new strings (see plan §B / open questions).
//   - `icon` — name from the shared Icon registry.
//   - `action` — discriminated union the HomeView dispatcher matches
//     on. The rail component itself stays presentational.

import type { ProjectKind, ProjectMetadata } from '@open-design/contracts';
import type { DefaultScenarioPluginId } from '@open-design/contracts';
import type { IconName } from '../Icon';

// Plugin ids the chip rail can dispatch to. Most chips route to a
// `DefaultScenarioPluginId` so the same fallback table the daemon
// uses for naked Home queries stays the source of truth. Specialised
// chips (HyperFrames lives under `plugins/_official/examples/hyperframes/`
// and surfaces as the `example-hyperframes` bundled plugin id) bypass
// the default table by carrying their own plugin id directly. The
// curated union keeps typo safety while letting the rail evolve
// independently of the default-binding mapping.
export type ChipScenarioPluginId =
  | DefaultScenarioPluginId
  | 'example-hyperframes';

export type ChipAction =
  | {
      kind: 'apply-scenario';
      pluginId: ChipScenarioPluginId;
      projectKind: ProjectKind;
      inputs?: Record<string, unknown>;
      projectMetadata?: ProjectMetadata;
    }
  | {
      kind: 'apply-figma-migration';
      pluginId: 'od-figma-migration';
      projectKind: ProjectKind;
      inputs?: Record<string, unknown>;
      projectMetadata?: ProjectMetadata;
    }
  | { kind: 'create-plugin' }
  | { kind: 'open-template-picker' };

// Two intent groups: "create" = ecommerce video workflow steps, "migrate" =
// lower-row starter shortcuts such as templates. The grouping is structural
// only — HomeHero renders the two groups in separate flex containers so they
// wrap onto separate rows on narrow viewports without horizontal scrolling.
export type ChipGroup = 'create' | 'migrate';

export interface HomeHeroChip {
  id: string;
  label: string;
  icon: IconName;
  group: ChipGroup;
  hint?: string;
  action: ChipAction;
}

export const HOME_HERO_CHIPS: ReadonlyArray<HomeHeroChip> = [
  {
    id: 'video',
    label: 'Ecommerce video',
    icon: 'play',
    group: 'create',
    action: {
      kind: 'apply-scenario',
      pluginId: 'od-media-generation',
      projectKind: 'video',
      inputs: {
        mediaKind: 'video',
        subject: 'a conversion-focused ecommerce product video',
        style: 'short-form, benefit-led, platform-ready',
        aspect: '9:16',
      },
    },
  },
  {
    id: 'image',
    label: 'Product assets',
    icon: 'image',
    group: 'create',
    action: {
      kind: 'apply-scenario',
      pluginId: 'od-media-generation',
      projectKind: 'image',
      inputs: {
        mediaKind: 'image',
        subject: 'product materials, reference frames, and cover visuals',
        style: 'clean ecommerce, high-conversion, on-brand',
        aspect: '1:1',
      },
    },
  },
  {
    id: 'hyperframes',
    label: 'Storyboard motion',
    icon: 'orbit',
    group: 'create',
    hint: 'Plan shot structure, captions, transitions, and render-ready motion.',
    action: { kind: 'apply-scenario', pluginId: 'example-hyperframes', projectKind: 'video' },
  },
  {
    id: 'audio',
    label: 'Voice / captions',
    icon: 'mic',
    group: 'create',
    action: {
      kind: 'apply-scenario',
      pluginId: 'od-media-generation',
      projectKind: 'audio',
      inputs: {
        mediaKind: 'audio',
        subject: 'voiceover, subtitle timing, and audio identity for a product video',
        style: 'clear, persuasive, platform-ready',
        aspect: '16:9',
      },
    },
  },
  {
    id: 'template',
    label: 'Template library',
    icon: 'file-code',
    group: 'migrate',
    hint: 'Start from an ecommerce video script, storyboard, platform, or reference template.',
    action: { kind: 'open-template-picker' },
  },
];

export function chipsForGroup(group: ChipGroup): HomeHeroChip[] {
  return HOME_HERO_CHIPS.filter((c) => c.group === group);
}

// Helper used by tests + the rail component to pull the chip metadata
// off a click target without round-tripping through React state.
export function findChip(id: string): HomeHeroChip | undefined {
  return HOME_HERO_CHIPS.find((c) => c.id === id);
}
