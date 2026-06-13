// Curated metadata overrides for Composio toolkits.
//
// Keep keys in sync with the slugs in DOCUMENTED_COMPOSIO_TOOLKITS. If a
// toolkit is missing from this map, composio.ts falls back to a neutral
// description generated from the display name.

export interface ComposioToolkitMetadata {
  /** Human-authored description tailored to the SaaS/tool. */
  description: string;
  /** Preferred category tag for the connector card. */
  category: string;
  /** Snapshot count for first paint before live toolkit metadata loads. */
  toolCount?: number;
}

export const COMPOSIO_TOOLKIT_METADATA: Record<string, ComposioToolkitMetadata> = {
  GITHUB: {
    description:
      'Browse repositories, read issues and pull requests, inspect commits, and search code across GitHub.',
    category: 'Developer',
    toolCount: 2,
  },
  YOUTUBE: {
    description:
      'Search YouTube videos, read channel and video metadata, and collect engagement signals for video workflows.',
    category: 'Video',
  },
  TIKTOK: {
    description:
      'Read TikTok videos, creators, and engagement data for short-video research and publishing workflows.',
    category: 'Video',
  },
  DOUYIN: {
    description:
      'Connect Douyin creator, short-video, and engagement data for domestic China commerce video workflows.',
    category: 'Video',
  },
  BILIBILI: {
    description:
      'Read Bilibili videos, channels, comments, and engagement signals for video research and publishing workflows.',
    category: 'Video',
  },
};

/**
 * Resolve curated metadata for a toolkit slug. Returns undefined when the
 * toolkit has not been manually described yet - callers should fall back to a
 * generic description in that case.
 */
export function getComposioToolkitMetadata(slug: string): ComposioToolkitMetadata | undefined {
  return COMPOSIO_TOOLKIT_METADATA[slug];
}
