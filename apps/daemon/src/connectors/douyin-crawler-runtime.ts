import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { BoundedJsonObject } from '../live-artifacts/schema.js';
import { ensureProject } from '../projects.js';

import type { ConnectorCatalogDefinition, ConnectorCatalogToolDefinition } from './catalog.js';
import type { VideoCrawlerExecutionOptions } from './bilibili-crawler-runtime.js';
import { ConnectorServiceError, type ConnectorCredentialMaterial } from './service.js';

interface ExecuteDouyinCrawlerToolOptions {
  definition: ConnectorCatalogDefinition;
  tool: ConnectorCatalogToolDefinition;
  input: BoundedJsonObject;
  credentials: ConnectorCredentialMaterial;
  context?: VideoCrawlerExecutionOptions;
}

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 aweme';
const DEFAULT_DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const DOUYIN_WEB_ORIGIN = 'https://www.douyin.com';
const DEFAULT_DOWNLOAD_MAX_BYTES = 512 * 1024 * 1024;

const SEARCH_SORT_MAP: Record<string, string> = {
  default: '0',
  relevance: '0',
  hot: '0',
  newest: '2',
  latest: '2',
  publish_time: '2',
};

export async function executeBuiltInDouyinCrawlerTool({
  definition,
  tool,
  input,
  credentials,
  context,
}: ExecuteDouyinCrawlerToolOptions): Promise<BoundedJsonObject> {
  if (definition.id !== 'douyin') {
    throw new ConnectorServiceError(
      'CONNECTOR_EXECUTION_FAILED',
      'Built-in video crawler runtime only supports Douyin',
      501,
      { connectorId: definition.id, toolName: tool.name },
    );
  }
  const providerToolId = tool.providerToolId ?? tool.name.split('.').at(-1) ?? tool.name;
  switch (providerToolId) {
    case 'douyin_search_videos':
      return executeSearchVideos(tool, input, credentials, context);
    default:
      throw new ConnectorServiceError('CONNECTOR_TOOL_NOT_FOUND', 'Douyin crawler tool is not implemented', 404, {
        connectorId: definition.id,
        toolName: tool.name,
      });
  }
}

async function executeSearchVideos(
  tool: ConnectorCatalogToolDefinition,
  input: BoundedJsonObject,
  credentials: ConnectorCredentialMaterial,
  context: VideoCrawlerExecutionOptions | undefined,
): Promise<BoundedJsonObject> {
  const query = stringInput(input, 'query');
  if (!query) {
    throw new ConnectorServiceError('CONNECTOR_INPUT_SCHEMA_MISMATCH', 'input.query is required', 400, {
      connectorId: 'douyin',
      toolName: tool.name,
    });
  }
  const limit = integerInput(input, 'limit', 20, 1, 50);
  const offset = cursorOffset(input);
  const parsed = await fetchDouyinJson(
    '/aweme/v1/web/general/search/single/',
    {
      device_platform: 'webapp',
      aid: '6383',
      channel: 'channel_pc_web',
      search_channel: 'aweme_general',
      keyword: query,
      offset,
      count: limit,
      sort_type: sortOrder(input),
      publish_time: '0',
      type: 'general',
      is_filter_search: '0',
    },
    credentials,
    context,
    `https://www.douyin.com/search/${encodeURIComponent(query)}?type=video`,
  );
  const data = Array.isArray(parsed.data) ? parsed.data : Array.isArray(parsed.aweme_list) ? parsed.aweme_list : [];
  const items = data
    .map(searchRecordToAweme)
    .filter(isRecord)
    .slice(0, limit)
    .map(searchItemToJson);
  const total = integerField(parsed.total ?? parsed.total_count);
  const hasMore = booleanField(parsed.has_more) ?? (total === null ? items.length >= limit : offset + items.length < total);
  const nextCursor = hasMore ? String(integerField(parsed.cursor) ?? offset + items.length) : null;
  return {
    ok: true,
    toolName: tool.name,
    provider: 'douyin-web',
    query,
    count: items.length,
    items,
    nextCursor,
    totalAvailable: total,
  };
}

async function fetchDouyinJson(
  pathname: string,
  searchParams: Record<string, string | number | undefined>,
  credentials: ConnectorCredentialMaterial,
  context: VideoCrawlerExecutionOptions | undefined,
  referer: string,
): Promise<Record<string, unknown>> {
  const url = new URL(pathname, DOUYIN_WEB_ORIGIN);
  for (const [key, value] of Object.entries(searchParams)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    headers: credentialHeaders(credentials, referer),
    ...(context?.signal === undefined ? {} : { signal: context.signal }),
  });
  if (!response.ok) {
    throw new ConnectorServiceError(
      'CONNECTOR_EXECUTION_FAILED',
      `Douyin search request failed with HTTP ${response.status}`,
      response.status === 401 || response.status === 403 ? 403 : 502,
      { connectorId: 'douyin', status: response.status },
    );
  }
  const parsed = (await response.json()) as unknown;
  if (!isRecord(parsed)) {
    throw new ConnectorServiceError('CONNECTOR_EXECUTION_FAILED', 'Douyin search returned a non-object response', 502, {
      connectorId: 'douyin',
    });
  }
  const statusCode = integerField(parsed.status_code);
  if (statusCode !== null && statusCode !== 0) {
    throw new ConnectorServiceError(
      'CONNECTOR_EXECUTION_FAILED',
      cleanText(parsed.status_msg ?? parsed.message, 200) || `Douyin search failed with status ${statusCode}`,
      statusCode === 8 || statusCode === 10008 ? 403 : 502,
      { connectorId: 'douyin', statusCode },
    );
  }
  return parsed;
}

function searchRecordToAweme(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const directId = stringField(value.aweme_id ?? value.awemeId ?? value.id);
  if (directId) return value;
  for (const key of ['aweme_info', 'aweme', 'awemeInfo', 'video']) {
    const nested = value[key];
    if (isRecord(nested)) {
      const nestedId = stringField(nested.aweme_id ?? nested.awemeId ?? nested.id);
      if (nestedId) return nested;
    }
  }
  return undefined;
}

function searchItemToJson(aweme: Record<string, unknown>): BoundedJsonObject {
  const videoId = stringField(aweme.aweme_id ?? aweme.awemeId ?? aweme.id) ?? '';
  const title = cleanText(aweme.desc ?? aweme.title, 300);
  const author = isRecord(aweme.author) ? aweme.author : {};
  const stats = isRecord(aweme.statistics) ? aweme.statistics : isRecord(aweme.stats) ? aweme.stats : {};
  const video = isRecord(aweme.video) ? aweme.video : {};
  return {
    videoId,
    title,
    author: cleanText(author.nickname ?? author.name, 120),
    authorId: stringField(author.sec_uid ?? author.secUid ?? author.uid ?? author.id) ?? null,
    url: stringField(aweme.share_url ?? aweme.shareUrl) ?? (videoId ? makeDouyinVideoUrl(videoId) : ''),
    coverImage: firstUrlFromImage(video.cover) ?? firstUrlFromImage(video.origin_cover) ?? firstUrlFromImage(video.dynamic_cover),
    publishTime: isoFromSeconds(aweme.create_time ?? aweme.createTime),
    durationSeconds: durationSeconds(video.duration),
    description: title,
    metrics: {
      play: integerField(stats.play_count ?? stats.playCount),
      like: integerField(stats.digg_count ?? stats.diggCount ?? stats.like_count ?? stats.likeCount),
      favorite: integerField(stats.collect_count ?? stats.collectCount ?? stats.favorite_count ?? stats.favoriteCount),
      comment: integerField(stats.comment_count ?? stats.commentCount),
      share: integerField(stats.share_count ?? stats.shareCount),
    },
  };
}

function credentialHeaders(
  credentials: ConnectorCredentialMaterial,
  referer: string,
  accept = 'application/json, text/plain, */*',
): Record<string, string> {
  const cookie = stringField(credentials.cookie);
  const headers: Record<string, string> = {
    accept,
    referer,
    'user-agent': stringField(credentials.userAgent) ?? DEFAULT_DESKTOP_USER_AGENT,
  };
  if (cookie) headers.cookie = cookie;
  return headers;
}

export async function executePublicDouyinCrawlerDownload(
  input: BoundedJsonObject,
  context?: VideoCrawlerExecutionOptions,
): Promise<BoundedJsonObject> {
  const shareUrl = stringInput(input, 'url');
  if (!shareUrl) {
    throw new ConnectorServiceError(
      'CONNECTOR_INPUT_SCHEMA_MISMATCH',
      'Douyin public share import requires input.url',
      400,
      { connectorId: 'douyin' },
    );
  }

  const page = await fetchDouyinSharePage(shareUrl, context);
  const videoId = extractVideoId(page.resolvedUrl, page.html);
  const title = extractTitle(page.html) || videoId || 'Douyin public share video';
  const mediaCandidates = extractVideoCandidates(page.html);
  if (mediaCandidates.length === 0) {
    throw new ConnectorServiceError(
      'CONNECTOR_EXECUTION_FAILED',
      'Douyin public share page did not expose a downloadable video stream',
      502,
      { connectorId: 'douyin', resolvedUrl: page.resolvedUrl },
    );
  }

  const downloaded = await downloadFirstVideoCandidate({
    candidates: mediaCandidates,
    context,
    referer: page.resolvedUrl,
    title,
    ...(videoId ? { videoId } : {}),
  });
  const metrics = extractMetrics(page.html);
  return {
    ok: true,
    provider: 'douyin-public-share',
    path: downloaded.path,
    absolutePath: downloaded.absolutePath,
    savedBytes: downloaded.savedBytes,
    format: downloaded.format,
    source: {
      shareUrl,
      resolvedUrl: page.resolvedUrl,
      kind: page.resolvedUrl.includes('/share/note/') ? 'note' : 'video',
    },
    video: {
      videoId: videoId ?? null,
      title,
      url: page.resolvedUrl,
      downloadUrl: downloaded.url,
      metrics,
    },
    limitations: douyinPublicLimitations(),
  };
}

async function fetchDouyinSharePage(
  url: string,
  context: VideoCrawlerExecutionOptions | undefined,
): Promise<{ resolvedUrl: string; html: string }> {
  let current = url;
  for (let redirect = 0; redirect < 6; redirect += 1) {
    const response = await fetch(current, {
      redirect: 'manual',
      headers: douyinHeaders(current, 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'),
      ...(context?.signal === undefined ? {} : { signal: context.signal }),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) break;
      current = new URL(location, current).toString();
      continue;
    }
    if (!response.ok) {
      throw new ConnectorServiceError(
        'CONNECTOR_EXECUTION_FAILED',
        `Douyin public share request failed with HTTP ${response.status}`,
        response.status === 401 || response.status === 403 ? 403 : 502,
        { connectorId: 'douyin', status: response.status },
      );
    }
    return { resolvedUrl: current, html: await response.text() };
  }
  throw new ConnectorServiceError(
    'CONNECTOR_EXECUTION_FAILED',
    'Douyin public share URL redirected too many times',
    502,
    { connectorId: 'douyin' },
  );
}

function douyinHeaders(referer: string, accept: string): Record<string, string> {
  return {
    accept,
    referer,
    'user-agent': DEFAULT_USER_AGENT,
  };
}

function extractVideoId(resolvedUrl: string, html: string): string | undefined {
  const fromUrl = resolvedUrl.match(/\/share\/(?:video|note)\/(\d+)/)?.[1];
  if (fromUrl) return fromUrl;
  return findJsonString(html, ['aweme_id', 'awemeId', 'videoId'])?.replace(/[^\d]/g, '') || undefined;
}

function extractTitle(html: string): string {
  return (
    cleanText(findJsonString(html, ['desc', 'title'])) ||
    cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1])
  );
}

function extractMetrics(html: string): BoundedJsonObject {
  return {
    like: numberFromJsonField(html, 'digg_count'),
    favorite: numberFromJsonField(html, 'collect_count'),
    comment: numberFromJsonField(html, 'comment_count'),
    share: numberFromJsonField(html, 'share_count'),
  };
}

function extractVideoCandidates(html: string): string[] {
  const decoded = decodeEscapedText(html);
  const urls = new Set<string>();
  for (const match of decoded.matchAll(/https?:\/\/[^"'<>\s\\]+/g)) {
    const cleaned = cleanupUrl(match[0]);
    if (!cleaned) continue;
    urls.add(cleaned);
    const nested = nestedDouyinVideoUrl(cleaned);
    if (nested) urls.add(nested);
  }
  return [...urls].filter(isLikelyVideoUrl);
}

function cleanupUrl(raw: string): string {
  return raw
    .replace(/\\u002F/g, '/')
    .replace(/\\u0026/g, '&')
    .replace(/\\\//g, '/')
    .replace(/[),.;]+$/g, '')
    .trim();
}

function nestedDouyinVideoUrl(raw: string): string | undefined {
  try {
    const parsed = new URL(raw);
    const videoId = parsed.searchParams.get('video_id');
    if (videoId?.startsWith('http')) return cleanupUrl(videoId);
  } catch {
    return undefined;
  }
  return undefined;
}

function isLikelyVideoUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();
    if (host.includes('douyinpic.com')) return false;
    if (/\.(jpe?g|png|webp|gif|avif)(?:$|\?)/i.test(pathname)) return false;
    return (
      host.includes('douyinstatic.com') ||
      host.includes('snssdk.com') ||
      host.includes('bytecdn') ||
      pathname.includes('/aweme/v1/play')
    );
  } catch {
    return false;
  }
}

async function downloadFirstVideoCandidate(input: {
  candidates: string[];
  context: VideoCrawlerExecutionOptions | undefined;
  referer: string;
  title: string;
  videoId?: string;
}): Promise<{ url: string; path: string; absolutePath: string; savedBytes: number; format: string }> {
  const failures: string[] = [];
  for (const candidate of input.candidates) {
    try {
      return await downloadVideoCandidate({ ...input, url: candidate });
    } catch (error) {
      failures.push(`${candidate}: ${errorMessage(error)}`);
    }
  }
  throw new ConnectorServiceError(
    'CONNECTOR_EXECUTION_FAILED',
    `Douyin public share did not return a usable video file. ${failures.slice(0, 3).join(' | ')}`,
    502,
    { connectorId: 'douyin' },
  );
}

async function downloadVideoCandidate(input: {
  url: string;
  context: VideoCrawlerExecutionOptions | undefined;
  referer: string;
  title: string;
  videoId?: string;
}): Promise<{ url: string; path: string; absolutePath: string; savedBytes: number; format: string }> {
  const response = await fetch(input.url, {
    headers: douyinHeaders(input.referer, 'video/*, application/octet-stream, */*'),
    ...(input.context?.signal === undefined ? {} : { signal: input.context.signal }),
  });
  if (!response.ok) {
    throw new Error(`download failed with HTTP ${response.status}`);
  }
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (contentType.startsWith('audio/') || contentType.startsWith('image/')) {
    throw new Error(`candidate is not a video stream (${contentType || 'unknown content-type'})`);
  }
  if (!contentType.startsWith('video/') && !contentType.includes('octet-stream') && !hasVideoExtension(input.url)) {
    throw new Error(`candidate content type is not video (${contentType || 'unknown content-type'})`);
  }
  const declaredLength = numberField(response.headers.get('content-length'));
  const maxBytes = maxDownloadBytes();
  if (declaredLength !== null && declaredLength > maxBytes) {
    throw new ConnectorServiceError('CONNECTOR_OUTPUT_TOO_LARGE', 'Douyin media file is larger than the limit', 413, {
      connectorId: 'douyin',
      declaredBytes: declaredLength,
      maxBytes,
    });
  }
  const body = Buffer.from(await response.arrayBuffer());
  if (body.byteLength > maxBytes) {
    throw new ConnectorServiceError('CONNECTOR_OUTPUT_TOO_LARGE', 'Douyin media file is larger than the limit', 413, {
      connectorId: 'douyin',
      bytes: body.byteLength,
      maxBytes,
    });
  }
  const extension = extensionFromUrl(input.url);
  const baseName = input.videoId ? `${input.videoId}-${input.title}` : input.title;
  const fileName = `${sanitizeFileSegment(baseName.replace(/\.[a-z0-9]+$/i, ''))}.${extension}`;
  const artifactDir = await resolveArtifactDir(input.context);
  const absolutePath = path.join(artifactDir.dir, fileName);
  const relativePath = `${artifactDir.relDir}/${fileName}`;
  await writeFile(absolutePath, body);
  return { url: input.url, path: relativePath, absolutePath, savedBytes: body.byteLength, format: extension };
}

async function resolveArtifactDir(context: VideoCrawlerExecutionOptions | undefined): Promise<{
  dir: string;
  relDir: string;
}> {
  if (context?.projectsRoot && context.projectId) {
    const projectDir = await ensureProject(context.projectsRoot, context.projectId);
    const relDir = 'video-crawler';
    const dir = path.join(projectDir, relDir);
    await mkdir(dir, { recursive: true });
    return { dir, relDir };
  }
  const dir = path.join(process.cwd(), '.od', 'artifacts', 'video-crawler');
  await mkdir(dir, { recursive: true });
  return { dir, relDir: 'video-crawler' };
}

function findJsonString(html: string, keys: string[]): string {
  for (const key of keys) {
    const match = html.match(new RegExp(`"${escapeRegex(key)}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, 'i'));
    if (match?.[1]) return decodeJsonString(match[1]);
  }
  return '';
}

function numberFromJsonField(html: string, key: string): number | null {
  const match = html.match(new RegExp(`"${escapeRegex(key)}"\\s*:\\s*(\\d+)`, 'i'));
  if (!match?.[1]) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function decodeEscapedText(value: string): string {
  return value.replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

function decodeJsonString(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return decodeEscapedText(value);
  }
}

function cleanText(value: unknown, maxLength = 300): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function stringInput(input: BoundedJsonObject, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function integerInput(input: BoundedJsonObject, key: string, fallback: number, min: number, max: number): number {
  const value = input[key];
  if (typeof value !== 'number' || !Number.isInteger(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

function cursorOffset(input: BoundedJsonObject): number {
  const cursor = stringInput(input, 'cursor');
  if (!cursor) return 0;
  const parsed = Number.parseInt(cursor, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function sortOrder(input: BoundedJsonObject): string {
  const sort = stringInput(input, 'sort')?.toLowerCase() ?? 'default';
  return SEARCH_SORT_MAP[sort] ?? '0';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function numberField(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/,/g, '');
  if (!trimmed || trimmed === '--') return null;
  const unit = trimmed.at(-1);
  const multiplier = unit === '万' ? 10_000 : unit === '亿' ? 100_000_000 : 1;
  const numericText = multiplier === 1 ? trimmed : trimmed.slice(0, -1);
  const parsed = Number.parseFloat(numericText);
  return Number.isFinite(parsed) ? Math.round(parsed * multiplier) : null;
}

function integerField(value: unknown): number | null {
  const numberValue = numberField(value);
  return numberValue === null ? null : Math.trunc(numberValue);
}

function booleanField(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 0 ? false : true;
  if (typeof value !== 'string') return null;
  if (value === '0' || value.toLowerCase() === 'false') return false;
  if (value === '1' || value.toLowerCase() === 'true') return true;
  return null;
}

function isoFromSeconds(value: unknown): string | null {
  const seconds = numberField(value);
  if (seconds === null || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}

function makeDouyinVideoUrl(videoId: string): string {
  return `https://www.douyin.com/video/${encodeURIComponent(videoId)}`;
}

function firstUrlFromImage(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (!isRecord(value)) return null;
  const urlList = value.url_list ?? value.urlList;
  if (!Array.isArray(urlList)) return stringField(value.uri) ?? null;
  const first = urlList.find((entry) => typeof entry === 'string' && entry.trim().length > 0);
  return typeof first === 'string' ? first : null;
}

function durationSeconds(value: unknown): number | null {
  const duration = numberField(value);
  if (duration === null) return null;
  return duration > 1000 ? Math.round(duration / 1000) : duration;
}

function hasVideoExtension(url: string): boolean {
  try {
    return /\.(mp4|m4v|mov|webm)(?:$|\?)/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

function extensionFromUrl(url: string): string {
  try {
    const ext = path.extname(new URL(url).pathname).replace('.', '').replace(/[^a-z0-9]/gi, '');
    if (ext) return ext.toLowerCase();
  } catch {
    // Fall through to mp4.
  }
  return 'mp4';
}

function sanitizeFileSegment(value: string): string {
  const sanitized = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 160);
  return sanitized.length > 0 ? sanitized : `douyin-${Date.now()}`;
}

function maxDownloadBytes(): number {
  const parsed = Number.parseInt(process.env.OD_VIDEO_CRAWLER_MAX_DOWNLOAD_BYTES ?? '', 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_DOWNLOAD_MAX_BYTES;
}

function douyinPublicLimitations(): string[] {
  return [
    '仅解析用户提供的抖音公开分享页中暴露的公开视频资源。',
    '不使用登录 Cookie，不绕过验证码、权限、付费、风控或平台限制。',
    '不去水印；若分享页只暴露图文、音频或封面而非视频流，则不会伪装成视频导入。',
  ];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
