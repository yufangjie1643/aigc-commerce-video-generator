import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { BoundedJsonObject } from '../live-artifacts/schema.js';
import { ensureProject } from '../projects.js';

import type { VideoCrawlerExecutionOptions } from './bilibili-crawler-runtime.js';
import { ConnectorServiceError } from './service.js';

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 aweme';
const DEFAULT_DOWNLOAD_MAX_BYTES = 512 * 1024 * 1024;

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

function numberField(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
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
