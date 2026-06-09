import type { BoundedJsonObject } from '../live-artifacts/schema.js';

import {
  defineConnectorTool,
  type ConnectorCatalogDefinition,
  type ConnectorCatalogToolDefinition,
} from './catalog.js';
import { ConnectorServiceError, type ConnectorCredentialMaterial } from './service.js';
import {
  executeBuiltInBilibiliCrawlerTool,
  type VideoCrawlerExecutionOptions,
} from './bilibili-crawler-runtime.js';

export const VIDEO_CRAWLER_PROVIDER = 'open-design-video-crawler';
export const VIDEO_CRAWLER_CREDENTIAL_PROVIDER = 'video-crawler-cookie';

const VIDEO_CRAWLER_LOGIN_TTL_MS = 10 * 60 * 1000;

const VIDEO_CRAWLER_READ_SAFETY = {
  sideEffect: 'read',
  approval: 'auto',
  reason:
    'Video crawler tools read platform data with the user-provided cookie session and do not mutate the remote account.',
} as const;

interface VideoCrawlerPlatform {
  id: 'youtube' | 'tiktok' | 'douyin' | 'bilibili';
  name: string;
  category: string;
  description: string;
  loginUrl: string;
  cookieDomains: string[];
}

const VIDEO_CRAWLER_PLATFORMS: VideoCrawlerPlatform[] = [
  {
    id: 'youtube',
    name: 'YouTube',
    category: 'Video',
    description: 'Search YouTube videos, download source media, read engagement metrics, and collect comment threads.',
    loginUrl: 'https://www.youtube.com/',
    cookieDomains: ['youtube.com', 'google.com'],
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    category: 'Video',
    description:
      'Search TikTok short videos, download source media, read engagement metrics, and collect comment threads.',
    loginUrl: 'https://www.tiktok.com/',
    cookieDomains: ['tiktok.com'],
  },
  {
    id: 'douyin',
    name: '抖音',
    category: 'Video',
    description: '登录抖音后搜索短视频、下载素材、读取播放/点赞/收藏等指标，并抓取评论区文本和互动数。',
    loginUrl: 'https://www.douyin.com/',
    cookieDomains: ['douyin.com'],
  },
  {
    id: 'bilibili',
    name: 'Bilibili',
    category: 'Video',
    description: '登录 B 站后搜索视频、下载素材、读取播放/点赞/收藏/投币等指标，并抓取评论区文本和互动数。',
    loginUrl: 'https://www.bilibili.com/',
    cookieDomains: ['bilibili.com'],
  },
];

const VIDEO_SEARCH_INPUT_SCHEMA: BoundedJsonObject = {
  type: 'object',
  properties: {
    query: { type: 'string', maxLength: 200 },
    limit: { type: 'integer', minimum: 1, maximum: 50 },
    sort: { type: 'string', maxLength: 40 },
    cursor: { type: 'string', maxLength: 500 },
  },
  required: ['query'],
  additionalProperties: false,
};

const VIDEO_TARGET_INPUT_SCHEMA: BoundedJsonObject = {
  type: 'object',
  properties: {
    url: { type: 'string', maxLength: 2000 },
    videoId: { type: 'string', maxLength: 200 },
    includeStats: { type: 'boolean' },
  },
  additionalProperties: false,
};

const VIDEO_DOWNLOAD_INPUT_SCHEMA: BoundedJsonObject = {
  type: 'object',
  properties: {
    url: { type: 'string', maxLength: 2000 },
    videoId: { type: 'string', maxLength: 200 },
    resolution: { type: 'string', maxLength: 40 },
    format: { type: 'string', maxLength: 20 },
    outputFileName: { type: 'string', maxLength: 180 },
  },
  additionalProperties: false,
};

const VIDEO_COMMENTS_INPUT_SCHEMA: BoundedJsonObject = {
  type: 'object',
  properties: {
    url: { type: 'string', maxLength: 2000 },
    videoId: { type: 'string', maxLength: 200 },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
    cursor: { type: 'string', maxLength: 500 },
  },
  additionalProperties: false,
};

const VIDEO_ANALYZE_INPUT_SCHEMA: BoundedJsonObject = {
  type: 'object',
  properties: {
    url: { type: 'string', maxLength: 2000 },
    videoId: { type: 'string', maxLength: 200 },
    includeComments: { type: 'boolean' },
    commentsLimit: { type: 'integer', minimum: 1, maximum: 100 },
  },
  additionalProperties: false,
};

const VIDEO_ANALYZE_COMMENTS_INPUT_SCHEMA: BoundedJsonObject = {
  type: 'object',
  properties: {
    url: { type: 'string', maxLength: 2000 },
    videoId: { type: 'string', maxLength: 200 },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
    cursor: { type: 'string', maxLength: 500 },
  },
  additionalProperties: false,
};

const VIDEO_LIST_OUTPUT_SCHEMA: BoundedJsonObject = {
  type: 'object',
  additionalProperties: true,
};

function crawlerTool(
  platform: VideoCrawlerPlatform,
  suffix: string,
  title: string,
  description: string,
  inputSchemaJson: BoundedJsonObject,
): ConnectorCatalogToolDefinition {
  return defineConnectorTool({
    name: `${platform.id}.${suffix}`,
    providerToolId: suffix,
    title,
    description,
    inputSchemaJson,
    outputSchemaJson: VIDEO_LIST_OUTPUT_SCHEMA,
    requiredScopes: ['read'],
    safety: VIDEO_CRAWLER_READ_SAFETY,
    refreshEligible: true,
  });
}

function createPlatformDefinition(platform: VideoCrawlerPlatform): ConnectorCatalogDefinition {
  const tools = [
    crawlerTool(
      platform,
      `${platform.id}_search_videos`,
      'Search videos',
      `Search ${platform.name} videos and return video ids, titles, authors, URLs, cover images, publish time, and engagement counters.`,
      VIDEO_SEARCH_INPUT_SCHEMA,
    ),
    crawlerTool(
      platform,
      `${platform.id}_get_video`,
      'Get video metrics',
      `Read one ${platform.name} video, including available resolutions, play count, like count, favorite count, share count, and comment count when available.`,
      VIDEO_TARGET_INPUT_SCHEMA,
    ),
    crawlerTool(
      platform,
      `${platform.id}_download_video`,
      'Download video',
      `Download a ${platform.name} video into the project artifact area and return the saved path, selected resolution, format, and metadata.`,
      VIDEO_DOWNLOAD_INPUT_SCHEMA,
    ),
    crawlerTool(
      platform,
      `${platform.id}_get_comments`,
      'Get comments',
      `Fetch ${platform.name} comment text, authors, like counts, reply counts, timestamps, and pagination cursor for a video.`,
      VIDEO_COMMENTS_INPUT_SCHEMA,
    ),
  ];
  if (platform.id === 'bilibili') {
    tools.push(
      crawlerTool(
        platform,
        'bilibili_analyze_video',
        'Analyze video',
        'Analyze one Bilibili video using metadata, engagement counters, available resolutions, and an optional comment sample.',
        VIDEO_ANALYZE_INPUT_SCHEMA,
      ),
      crawlerTool(
        platform,
        'bilibili_analyze_comments',
        'Analyze comments',
        'Analyze Bilibili comments for purchase intent, questions, price concerns, quality concerns, sentiment, and top liked comments.',
        VIDEO_ANALYZE_COMMENTS_INPUT_SCHEMA,
      ),
    );
  }
  const allowedToolNames = tools.map((tool) => tool.name);
  return {
    id: platform.id,
    name: platform.name,
    provider: VIDEO_CRAWLER_PROVIDER,
    category: platform.category,
    description: platform.description,
    authentication: 'cookie',
    providerConnectorId: platform.id,
    tools,
    allowedToolNames,
    curatedToolNames: allowedToolNames,
    featuredToolNames: allowedToolNames.slice(0, 3),
    minimumApproval: 'auto',
    toolCount: tools.length,
  };
}

const VIDEO_CRAWLER_DEFINITIONS = VIDEO_CRAWLER_PLATFORMS.map(createPlatformDefinition);

export function getStaticVideoCrawlerDefinitions(): ConnectorCatalogDefinition[] {
  return VIDEO_CRAWLER_DEFINITIONS.map((definition) => {
    const copy: ConnectorCatalogDefinition = {
      ...definition,
      tools: definition.tools.map((tool) => ({ ...tool, safety: { ...tool.safety } })),
      allowedToolNames: [...definition.allowedToolNames],
      curatedToolNames: [...(definition.curatedToolNames ?? definition.allowedToolNames)],
    };
    if (definition.featuredToolNames !== undefined) {
      copy.featuredToolNames = [...definition.featuredToolNames];
    }
    return copy;
  });
}

export function isVideoCrawlerConnectorId(connectorId: string): boolean {
  return VIDEO_CRAWLER_PLATFORMS.some((platform) => platform.id === connectorId);
}

export function isVideoCrawlerDefinition(definition: ConnectorCatalogDefinition): boolean {
  return definition.provider === VIDEO_CRAWLER_PROVIDER || isVideoCrawlerConnectorId(definition.id);
}

export function getVideoCrawlerPlatformConfig(connectorId: string):
  | {
      id: VideoCrawlerPlatform['id'];
      name: string;
      loginUrl: string;
      cookieDomains: string[];
    }
  | undefined {
  const platform = VIDEO_CRAWLER_PLATFORMS.find((entry) => entry.id === connectorId);
  if (!platform) return undefined;
  return {
    id: platform.id,
    name: platform.name,
    loginUrl: platform.loginUrl,
    cookieDomains: [...platform.cookieDomains],
  };
}

export function videoCrawlerLoginStart(connectorId: string): {
  kind: 'redirect_required';
  redirectUrl: string;
  expiresAt: string;
} {
  const platform = VIDEO_CRAWLER_PLATFORMS.find((entry) => entry.id === connectorId);
  if (!platform) {
    throw new ConnectorServiceError('CONNECTOR_NOT_FOUND', 'video crawler connector not found', 404, { connectorId });
  }
  return {
    kind: 'redirect_required',
    redirectUrl: platform.loginUrl,
    expiresAt: new Date(Date.now() + VIDEO_CRAWLER_LOGIN_TTL_MS).toISOString(),
  };
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export function normalizeVideoCrawlerCredentials(
  definition: ConnectorCatalogDefinition,
  credentials: ConnectorCredentialMaterial | undefined,
): ConnectorCredentialMaterial {
  if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) {
    throw new ConnectorServiceError(
      'CONNECTOR_NOT_CONNECTED',
      `${definition.name} cookie credentials are required`,
      403,
      { connectorId: definition.id },
    );
  }
  const cookie = stringField(credentials.cookie) ?? stringField(credentials.cookies);
  if (!cookie) {
    throw new ConnectorServiceError(
      'CONNECTOR_NOT_CONNECTED',
      `${definition.name} cookie credentials are required`,
      403,
      { connectorId: definition.id },
    );
  }
  const userAgent = stringField(credentials.userAgent);
  const accountLabel = stringField(credentials.accountLabel);
  return {
    provider: VIDEO_CRAWLER_CREDENTIAL_PROVIDER,
    platform: definition.id,
    cookie,
    ...(userAgent === undefined ? {} : { userAgent }),
    ...(accountLabel === undefined ? {} : { accountLabel }),
  };
}

export class VideoCrawlerConnectorProvider {
  getFastDefinitions(): ConnectorCatalogDefinition[] {
    return getStaticVideoCrawlerDefinitions();
  }

  async execute(
    definition: ConnectorCatalogDefinition,
    tool: ConnectorCatalogToolDefinition,
    input: BoundedJsonObject,
    credentials: ConnectorCredentialMaterial | undefined,
    options: VideoCrawlerExecutionOptions = {},
  ): Promise<BoundedJsonObject> {
    const normalizedCredentials = normalizeVideoCrawlerCredentials(definition, credentials);
    const crawlerBaseUrl = process.env.OD_VIDEO_CRAWLER_URL?.trim();
    if (!crawlerBaseUrl) {
      if (definition.id === 'bilibili') {
        return executeBuiltInBilibiliCrawlerTool({
          definition,
          tool,
          input,
          credentials: normalizedCredentials,
          context: options,
        });
      }
      throw new ConnectorServiceError(
        'CONNECTOR_EXECUTION_FAILED',
        'Video crawler runtime is not configured. Set OD_VIDEO_CRAWLER_URL to the cookie-aware crawler bridge.',
        501,
        {
          connectorId: definition.id,
          toolName: tool.name,
        },
      );
    }
    const endpoint = new URL('/api/video-crawler/execute', crawlerBaseUrl);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        connectorId: definition.id,
        toolName: tool.name,
        providerToolId: tool.providerToolId ?? tool.name,
        input,
        credentials: normalizedCredentials,
      }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    if (!response.ok) {
      throw new ConnectorServiceError(
        'CONNECTOR_EXECUTION_FAILED',
        `Video crawler runtime failed with HTTP ${response.status}`,
        response.status === 401 || response.status === 403 ? 403 : 502,
        {
          connectorId: definition.id,
          toolName: tool.name,
        },
      );
    }
    const payload = (await response.json()) as unknown;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new ConnectorServiceError(
        'CONNECTOR_EXECUTION_FAILED',
        'Video crawler runtime returned a non-object payload',
        502,
        {
          connectorId: definition.id,
          toolName: tool.name,
        },
      );
    }
    return payload as BoundedJsonObject;
  }
}

export const videoCrawlerConnectorProvider = new VideoCrawlerConnectorProvider();
