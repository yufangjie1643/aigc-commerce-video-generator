import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { BoundedJsonObject, BoundedJsonValue } from '../live-artifacts/schema.js';
import { ensureProject } from '../projects.js';

import type { ConnectorCatalogDefinition, ConnectorCatalogToolDefinition } from './catalog.js';
import { ConnectorServiceError, type ConnectorCredentialMaterial } from './service.js';

export interface VideoCrawlerExecutionOptions {
  projectsRoot?: string;
  projectId?: string;
  signal?: AbortSignal;
}

interface ExecuteBilibiliCrawlerToolOptions {
  definition: ConnectorCatalogDefinition;
  tool: ConnectorCatalogToolDefinition;
  input: BoundedJsonObject;
  credentials: ConnectorCredentialMaterial;
  context?: VideoCrawlerExecutionOptions;
}

interface BilibiliTarget {
  aid?: number;
  bvid?: string;
}

interface BilibiliResolvedVideo {
  aid: number;
  bvid: string;
  cid: number;
  title: string;
  description: string;
  url: string;
  coverImage: string | null;
  publishTime: string | null;
  durationSeconds: number | null;
  author: BoundedJsonObject;
  metrics: BoundedJsonObject;
  pages: BoundedJsonValue[];
  category: string | null;
}

interface BilibiliVideoWithPlayUrl {
  video: BilibiliResolvedVideo;
  playUrl: Record<string, unknown>;
  availableResolutions: BoundedJsonValue[];
}

interface BilibiliComment {
  commentId: string;
  author: string;
  authorId: string | null;
  text: string;
  likeCount: number;
  replyCount: number;
  createdAt: string | null;
}

interface BilibiliCommentsResult {
  comments: BilibiliComment[];
  nextCursor: string | null;
  totalAvailable: number | null;
}

const BILIBILI_API_ORIGIN = 'https://api.bilibili.com';
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const DEFAULT_DOWNLOAD_MAX_BYTES = 512 * 1024 * 1024;
const COMMENT_PAGE_SIZE_MAX = 20;

const SORT_MAP: Record<string, string> = {
  default: 'totalrank',
  relevance: 'totalrank',
  totalrank: 'totalrank',
  hot: 'click',
  click: 'click',
  views: 'click',
  newest: 'pubdate',
  pubdate: 'pubdate',
  comments: 'dm',
  danmaku: 'dm',
  favorites: 'stow',
  stow: 'stow',
};

const QUALITY_LABELS: Record<number, string> = {
  16: '360P',
  32: '480P',
  64: '720P',
  80: '1080P',
  112: '1080P+',
  116: '1080P60',
  120: '4K',
  125: 'HDR',
  126: 'Dolby Vision',
  127: '8K',
};

const COMMERCE_SIGNAL_PATTERNS: Array<{ label: string; pattern: RegExp; weight: number }> = [
  { label: 'AI digital human', pattern: /ai|人工智能|数字人|虚拟人|虚拟主播|aigc/i, weight: 2 },
  { label: 'commerce intent', pattern: /带货|卖货|橱窗|商品|下单|成交|转化|直播间|投流/, weight: 3 },
  { label: 'tutorial/tooling', pattern: /教程|工具|软件|系统|实操|搭建|流程|案例|拆解/, weight: 1 },
  { label: 'monetization', pattern: /变现|副业|赚钱|佣金|获客|私域|涨粉/, weight: 1 },
];

const PURCHASE_INTENT_PATTERNS = [/怎么买|哪里买|购买|下单|链接|求链接|橱窗|店铺|多少钱|价格|报价|同款/];
const QUESTION_PATTERNS = [/[?？]/, /怎么|哪里|什么|有没有|多少|可以吗|靠谱吗|求/];
const PRICE_CONCERN_PATTERNS = [/贵|便宜|价格|多少钱|报价|成本|收费|免费/];
const QUALITY_CONCERN_PATTERNS = [/假|割韭菜|没用|坑|骗子|翻车|效果差|不好用|不行|风险/];
const POSITIVE_PATTERNS = [/厉害|不错|好用|想要|收藏|有用|学习了|靠谱|真实|牛/];
const NEGATIVE_PATTERNS = [/假|割韭菜|没用|坑|骗子|差|贵|不行|翻车|垃圾/];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringInput(input: BoundedJsonObject, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function booleanInput(input: BoundedJsonObject, key: string): boolean | undefined {
  const value = input[key];
  return typeof value === 'boolean' ? value : undefined;
}

function integerInput(input: BoundedJsonObject, key: string, fallback: number, min: number, max: number): number {
  const value = input[key];
  if (typeof value !== 'number' || !Number.isInteger(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function numberField(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/,/g, '');
  if (trimmed.length === 0 || trimmed === '--') return null;
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

function isoFromSeconds(value: unknown): string | null {
  const seconds = numberField(value);
  if (seconds === null || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}

function cleanText(value: unknown, maxLength = 2_000): string {
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

function normalizeCoverUrl(value: unknown): string | null {
  const text = stringField(value);
  if (!text) return null;
  if (text.startsWith('//')) return `https:${text}`;
  return text;
}

function makeBilibiliUrl(bvid: string): string {
  return `https://www.bilibili.com/video/${encodeURIComponent(bvid)}/`;
}

function normalizeTarget(input: BoundedJsonObject): BilibiliTarget {
  const text = `${stringInput(input, 'videoId') ?? ''} ${stringInput(input, 'url') ?? ''}`;
  const bvid = text.match(/\b(BV[0-9A-Za-z]{8,})\b/)?.[1];
  if (bvid) return { bvid };
  const aidFromAv = text.match(/\bav(\d+)\b/i)?.[1];
  const aidFromNumber = text.match(/^\s*(\d+)\s*$/)?.[1];
  const aidText = aidFromAv ?? aidFromNumber;
  if (aidText) {
    const aid = Number.parseInt(aidText, 10);
    if (Number.isSafeInteger(aid) && aid > 0) return { aid };
  }
  throw new ConnectorServiceError(
    'CONNECTOR_INPUT_SCHEMA_MISMATCH',
    'Bilibili videoId or url must contain a BV id or av id',
    400,
  );
}

function sortOrder(input: BoundedJsonObject): string {
  const sort = stringInput(input, 'sort')?.toLowerCase() ?? 'default';
  return (SORT_MAP[sort] ?? sort.replace(/[^a-z0-9_]/g, '').slice(0, 40)) || 'totalrank';
}

function cursorPage(input: BoundedJsonObject): number {
  const cursor = stringInput(input, 'cursor');
  if (!cursor) return 1;
  const parsed = Number.parseInt(cursor, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

function credentialHeaders(
  credentials: ConnectorCredentialMaterial,
  referer = 'https://www.bilibili.com/',
  accept = 'application/json, text/plain, */*',
): Record<string, string> {
  const cookie = stringField(credentials.cookie);
  const headers: Record<string, string> = {
    accept,
    referer,
    'user-agent': stringField(credentials.userAgent) ?? DEFAULT_USER_AGENT,
  };
  if (cookie) headers.cookie = cookie;
  return headers;
}

async function fetchBilibiliJson(
  pathname: string,
  searchParams: Record<string, string | number | undefined>,
  credentials: ConnectorCredentialMaterial,
  options: VideoCrawlerExecutionOptions | undefined,
  referer?: string,
): Promise<unknown> {
  const url = new URL(pathname, BILIBILI_API_ORIGIN);
  for (const [key, value] of Object.entries(searchParams)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    headers: credentialHeaders(credentials, referer),
    ...(options?.signal === undefined ? {} : { signal: options.signal }),
  });
  if (!response.ok) {
    throw new ConnectorServiceError(
      'CONNECTOR_EXECUTION_FAILED',
      `Bilibili API request failed with HTTP ${response.status}`,
      response.status === 401 || response.status === 403 ? 403 : 502,
      { connectorId: 'bilibili', status: response.status },
    );
  }
  const parsed = (await response.json()) as unknown;
  if (!isRecord(parsed)) {
    throw new ConnectorServiceError('CONNECTOR_EXECUTION_FAILED', 'Bilibili API returned a non-object response', 502, {
      connectorId: 'bilibili',
    });
  }
  const code = typeof parsed.code === 'number' ? parsed.code : 0;
  if (code !== 0) {
    const message = stringField(parsed.message) ?? `Bilibili API returned code ${code}`;
    throw new ConnectorServiceError(
      'CONNECTOR_EXECUTION_FAILED',
      message,
      code === -101 || code === -403 ? 403 : 502,
      { connectorId: 'bilibili', apiCode: code, apiMessage: message },
    );
  }
  return parsed.data;
}

function searchItemToJson(item: Record<string, unknown>): BoundedJsonObject {
  const bvid = stringField(item.bvid) ?? stringField(item.id) ?? '';
  const aid = integerField(item.aid ?? item.id);
  const playCount = integerField(item.play);
  const favoriteCount = integerField(item.favorites);
  const commentCount = integerField(item.review);
  return {
    videoId: bvid,
    aid: aid ?? null,
    title: cleanText(item.title, 300),
    author: cleanText(item.author, 120),
    authorId: integerField(item.mid) ?? null,
    url: stringField(item.arcurl) ?? (bvid ? makeBilibiliUrl(bvid) : ''),
    coverImage: normalizeCoverUrl(item.pic),
    publishTime: isoFromSeconds(item.pubdate),
    description: cleanText(item.description, 1_000),
    metrics: {
      play: playCount,
      like: integerField(item.like),
      favorite: favoriteCount,
      comment: commentCount,
      danmaku: integerField(item.video_review),
    },
  };
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
      connectorId: 'bilibili',
      toolName: tool.name,
    });
  }
  const limit = integerInput(input, 'limit', 20, 1, 50);
  const page = cursorPage(input);
  const data = await fetchBilibiliJson(
    '/x/web-interface/search/type',
    {
      search_type: 'video',
      keyword: query,
      page,
      page_size: limit,
      order: sortOrder(input),
    },
    credentials,
    context,
  );
  const dataRecord = isRecord(data) ? data : {};
  const result = Array.isArray(dataRecord.result) ? dataRecord.result : [];
  const items = result.filter(isRecord).slice(0, limit).map(searchItemToJson);
  const total = integerField(dataRecord.numResults ?? dataRecord.num_results ?? dataRecord.total);
  const hasNext = total === null ? items.length >= limit : page * limit < total;
  return {
    ok: true,
    toolName: tool.name,
    provider: 'bilibili-web',
    query,
    count: items.length,
    items,
    nextCursor: hasNext ? String(page + 1) : null,
    totalAvailable: total,
  };
}

function parseVideoView(data: unknown): BilibiliResolvedVideo {
  if (!isRecord(data)) {
    throw new ConnectorServiceError('CONNECTOR_EXECUTION_FAILED', 'Bilibili video detail is missing', 502, {
      connectorId: 'bilibili',
    });
  }
  const bvid = stringField(data.bvid);
  const aid = integerField(data.aid);
  const pages = Array.isArray(data.pages) ? data.pages.filter(isRecord) : [];
  const firstPage = pages[0] ?? {};
  const cid = integerField(data.cid ?? firstPage.cid);
  if (!bvid || aid === null || cid === null) {
    throw new ConnectorServiceError('CONNECTOR_EXECUTION_FAILED', 'Bilibili video detail is incomplete', 502, {
      connectorId: 'bilibili',
    });
  }
  const owner = isRecord(data.owner) ? data.owner : {};
  const stat = isRecord(data.stat) ? data.stat : {};
  return {
    aid,
    bvid,
    cid,
    title: cleanText(data.title, 400),
    description: cleanText(data.desc, 4_000),
    url: makeBilibiliUrl(bvid),
    coverImage: normalizeCoverUrl(data.pic),
    publishTime: isoFromSeconds(data.pubdate),
    durationSeconds: integerField(data.duration),
    author: {
      name: cleanText(owner.name, 120),
      id: integerField(owner.mid),
    },
    metrics: {
      play: integerField(stat.view),
      like: integerField(stat.like),
      favorite: integerField(stat.favorite),
      coin: integerField(stat.coin),
      share: integerField(stat.share),
      comment: integerField(stat.reply),
      danmaku: integerField(stat.danmaku),
    },
    pages: pages.map((page) => ({
      cid: integerField(page.cid),
      page: integerField(page.page),
      title: cleanText(page.part, 300),
      durationSeconds: integerField(page.duration),
      width: integerField(isRecord(page.dimension) ? page.dimension.width : undefined),
      height: integerField(isRecord(page.dimension) ? page.dimension.height : undefined),
    })),
    category: stringField(data.tname) ?? null,
  };
}

async function fetchVideoView(
  target: BilibiliTarget,
  credentials: ConnectorCredentialMaterial,
  context: VideoCrawlerExecutionOptions | undefined,
): Promise<BilibiliResolvedVideo> {
  const data = await fetchBilibiliJson(
    '/x/web-interface/view',
    {
      ...(target.bvid === undefined ? {} : { bvid: target.bvid }),
      ...(target.aid === undefined ? {} : { aid: target.aid }),
    },
    credentials,
    context,
  );
  return parseVideoView(data);
}

function requestedQuality(input: BoundedJsonObject): number {
  const text = stringInput(input, 'resolution')?.toLowerCase();
  if (!text) return 127;
  if (text.includes('8k')) return 127;
  if (text.includes('4k') || text.includes('2160')) return 120;
  if (text.includes('1080')) return 80;
  if (text.includes('720')) return 64;
  if (text.includes('480')) return 32;
  if (text.includes('360')) return 16;
  const numeric = Number.parseInt(text, 10);
  if (Number.isSafeInteger(numeric) && numeric > 0) return numeric;
  return 127;
}

function qualityLabel(quality: number | null): string | null {
  if (quality === null) return null;
  return QUALITY_LABELS[quality] ?? `${quality}`;
}

function parseAvailableResolutions(playUrl: unknown): BoundedJsonValue[] {
  if (!isRecord(playUrl)) return [];
  const qualities = Array.isArray(playUrl.accept_quality) ? playUrl.accept_quality : [];
  const descriptions = Array.isArray(playUrl.accept_description) ? playUrl.accept_description : [];
  return qualities
    .map((quality, index) => {
      const qn = integerField(quality);
      if (qn === null) return null;
      const label = typeof descriptions[index] === 'string' ? descriptions[index] : qualityLabel(qn);
      return { quality: qn, label: label ?? String(qn) };
    })
    .filter((item) => item !== null) as BoundedJsonValue[];
}

async function fetchVideoWithPlayUrl(
  input: BoundedJsonObject,
  credentials: ConnectorCredentialMaterial,
  context: VideoCrawlerExecutionOptions | undefined,
): Promise<BilibiliVideoWithPlayUrl> {
  const video = await fetchVideoView(normalizeTarget(input), credentials, context);
  const playUrlData = await fetchBilibiliJson(
    '/x/player/playurl',
    {
      bvid: video.bvid,
      cid: video.cid,
      qn: requestedQuality(input),
      fnval: 16,
      fourk: 1,
    },
    credentials,
    context,
    video.url,
  );
  const playUrl = isRecord(playUrlData) ? playUrlData : {};
  return {
    video,
    playUrl,
    availableResolutions: parseAvailableResolutions(playUrl),
  };
}

async function executeGetVideo(
  tool: ConnectorCatalogToolDefinition,
  input: BoundedJsonObject,
  credentials: ConnectorCredentialMaterial,
  context: VideoCrawlerExecutionOptions | undefined,
): Promise<BoundedJsonObject> {
  const result = await fetchVideoWithPlayUrl(input, credentials, context);
  return {
    ok: true,
    toolName: tool.name,
    provider: 'bilibili-web',
    video: {
      videoId: result.video.bvid,
      ...result.video,
      availableResolutions: result.availableResolutions,
    },
  };
}

function pickMediaCandidate(playUrl: Record<string, unknown>): {
  downloadUrl: string;
  quality: number | null;
  format: string;
  kind: string;
} {
  const durl = Array.isArray(playUrl.durl) ? playUrl.durl.filter(isRecord)[0] : undefined;
  if (durl) {
    const downloadUrl = stringField(durl.url);
    if (downloadUrl) {
      return {
        downloadUrl,
        quality: integerField(playUrl.quality),
        format: stringField(playUrl.format) ?? 'mp4',
        kind: 'progressive',
      };
    }
  }
  const dash = isRecord(playUrl.dash) ? playUrl.dash : {};
  const dashVideo = Array.isArray(dash.video) ? dash.video.filter(isRecord)[0] : undefined;
  const downloadUrl = stringField(dashVideo?.baseUrl) ?? stringField(dashVideo?.base_url);
  if (downloadUrl) {
    return {
      downloadUrl,
      quality: integerField(dashVideo?.id ?? playUrl.quality),
      format: stringField(dashVideo?.mimeType)?.includes('mp4') ? 'mp4' : 'm4s',
      kind: 'dash-video',
    };
  }
  throw new ConnectorServiceError('CONNECTOR_EXECUTION_FAILED', 'Bilibili did not return a downloadable media URL', 502, {
    connectorId: 'bilibili',
  });
}

function sanitizeFileSegment(value: string): string {
  const sanitized = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 160);
  return sanitized.length > 0 ? sanitized : `bilibili-${Date.now()}`;
}

function extensionFromDownload(input: BoundedJsonObject, downloadUrl: string, fallback: string): string {
  const requested = stringInput(input, 'format')?.replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (requested) return requested;
  try {
    const ext = path.extname(new URL(downloadUrl).pathname).replace('.', '').replace(/[^a-z0-9]/gi, '');
    if (ext) return ext.toLowerCase();
  } catch {
    // Fall through to the API-reported format.
  }
  return fallback.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'mp4';
}

function maxDownloadBytes(): number {
  const parsed = Number.parseInt(process.env.OD_VIDEO_CRAWLER_MAX_DOWNLOAD_BYTES ?? '', 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_DOWNLOAD_MAX_BYTES;
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

async function writeJsonArtifact(
  context: VideoCrawlerExecutionOptions | undefined,
  fileName: string,
  content: BoundedJsonObject,
): Promise<{ path: string; absolutePath: string } | undefined> {
  const artifactDir = await resolveArtifactDir(context);
  const safeName = sanitizeFileSegment(fileName.replace(/\.json$/i, ''));
  const relPath = `${artifactDir.relDir}/${safeName}.json`;
  const absolutePath = path.join(artifactDir.dir, `${safeName}.json`);
  await writeFile(absolutePath, `${JSON.stringify(content, null, 2)}\n`, 'utf8');
  return { path: relPath, absolutePath };
}

async function executeDownloadVideo(
  tool: ConnectorCatalogToolDefinition,
  input: BoundedJsonObject,
  credentials: ConnectorCredentialMaterial,
  context: VideoCrawlerExecutionOptions | undefined,
): Promise<BoundedJsonObject> {
  const result = await fetchVideoWithPlayUrl(input, credentials, context);
  const media = pickMediaCandidate(result.playUrl);
  const extension = extensionFromDownload(input, media.downloadUrl, media.format);
  const baseName =
    stringInput(input, 'outputFileName') ??
    `${result.video.bvid}-${qualityLabel(media.quality) ?? 'selected'}-${result.video.title}`;
  const fileName = `${sanitizeFileSegment(baseName.replace(/\.[a-z0-9]+$/i, ''))}.${extension}`;
  const artifactDir = await resolveArtifactDir(context);
  const absolutePath = path.join(artifactDir.dir, fileName);
  const relativePath = `${artifactDir.relDir}/${fileName}`;
  const response = await fetch(media.downloadUrl, {
    headers: credentialHeaders(credentials, result.video.url, 'video/*, application/octet-stream, */*'),
    ...(context?.signal === undefined ? {} : { signal: context.signal }),
  });
  if (!response.ok) {
    throw new ConnectorServiceError(
      'CONNECTOR_EXECUTION_FAILED',
      `Bilibili media download failed with HTTP ${response.status}`,
      response.status === 401 || response.status === 403 ? 403 : 502,
      { connectorId: 'bilibili', status: response.status },
    );
  }
  const declaredLength = integerField(response.headers.get('content-length'));
  const maxBytes = maxDownloadBytes();
  if (declaredLength !== null && declaredLength > maxBytes) {
    throw new ConnectorServiceError('CONNECTOR_OUTPUT_TOO_LARGE', 'Bilibili media file is larger than the limit', 413, {
      connectorId: 'bilibili',
      declaredBytes: declaredLength,
      maxBytes,
    });
  }
  const body = Buffer.from(await response.arrayBuffer());
  if (body.byteLength > maxBytes) {
    throw new ConnectorServiceError('CONNECTOR_OUTPUT_TOO_LARGE', 'Bilibili media file is larger than the limit', 413, {
      connectorId: 'bilibili',
      bytes: body.byteLength,
      maxBytes,
    });
  }
  await writeFile(absolutePath, body);
  return {
    ok: true,
    toolName: tool.name,
    provider: 'bilibili-web',
    path: relativePath,
    absolutePath,
    savedBytes: body.byteLength,
    selectedResolution: qualityLabel(media.quality),
    selectedQuality: media.quality,
    format: extension,
    downloadKind: media.kind,
    video: {
      videoId: result.video.bvid,
      aid: result.video.aid,
      cid: result.video.cid,
      title: result.video.title,
      url: result.video.url,
      metrics: result.video.metrics,
      availableResolutions: result.availableResolutions,
    },
  };
}

function commentToJson(comment: Record<string, unknown>): BilibiliComment {
  const member = isRecord(comment.member) ? comment.member : {};
  const content = isRecord(comment.content) ? comment.content : {};
  return {
    commentId: String(integerField(comment.rpid) ?? stringField(comment.rpid_str) ?? ''),
    author: cleanText(member.uname, 120),
    authorId: integerField(member.mid)?.toString() ?? null,
    text: cleanText(content.message, 1_500),
    likeCount: integerField(comment.like) ?? 0,
    replyCount: integerField(comment.rcount) ?? 0,
    createdAt: isoFromSeconds(comment.ctime),
  };
}

async function fetchComments(
  input: BoundedJsonObject,
  credentials: ConnectorCredentialMaterial,
  context: VideoCrawlerExecutionOptions | undefined,
): Promise<{ video: BilibiliResolvedVideo; result: BilibiliCommentsResult }> {
  const video = await fetchVideoView(normalizeTarget(input), credentials, context);
  const requestedLimit = integerInput(input, 'limit', 50, 1, 100);
  const startPage = cursorPage(input);
  const comments: BilibiliComment[] = [];
  let totalAvailable: number | null = null;
  let page = startPage;
  while (comments.length < requestedLimit) {
    const pageSize = Math.min(COMMENT_PAGE_SIZE_MAX, requestedLimit - comments.length);
    const data = await fetchBilibiliJson(
      '/x/v2/reply',
      {
        type: 1,
        oid: video.aid,
        pn: page,
        ps: pageSize,
        sort: 2,
      },
      credentials,
      context,
      video.url,
    );
    const dataRecord = isRecord(data) ? data : {};
    const pageInfo = isRecord(dataRecord.page) ? dataRecord.page : {};
    totalAvailable = integerField(pageInfo.count);
    const replies = Array.isArray(dataRecord.replies) ? dataRecord.replies.filter(isRecord) : [];
    comments.push(...replies.map(commentToJson));
    if (replies.length < pageSize) break;
    if (totalAvailable !== null && page * pageSize >= totalAvailable) break;
    page += 1;
  }
  const nextCursor =
    totalAvailable !== null && comments.length > 0 && (page - 1) * COMMENT_PAGE_SIZE_MAX + comments.length < totalAvailable
      ? String(page + 1)
      : comments.length >= requestedLimit
        ? String(page + 1)
        : null;
  return {
    video,
    result: {
      comments: comments.slice(0, requestedLimit),
      nextCursor,
      totalAvailable,
    },
  };
}

async function executeGetComments(
  tool: ConnectorCatalogToolDefinition,
  input: BoundedJsonObject,
  credentials: ConnectorCredentialMaterial,
  context: VideoCrawlerExecutionOptions | undefined,
): Promise<BoundedJsonObject> {
  const { video, result } = await fetchComments(input, credentials, context);
  const output: BoundedJsonObject = {
    ok: true,
    toolName: tool.name,
    provider: 'bilibili-web',
    count: result.comments.length,
    nextCursor: result.nextCursor,
    totalAvailable: result.totalAvailable,
    video: {
      videoId: video.bvid,
      aid: video.aid,
      title: video.title,
      url: video.url,
      metrics: video.metrics,
    },
    comments: result.comments as unknown as BoundedJsonValue,
  };
  const saved = await writeJsonArtifact(context, `comments-${video.bvid}.json`, output);
  return saved === undefined ? output : { ...output, path: saved.path, absolutePath: saved.absolutePath };
}

function numberFromObject(object: BoundedJsonObject, key: string): number {
  const value = object[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function signalMatches(text: string): BoundedJsonObject[] {
  return COMMERCE_SIGNAL_PATTERNS.filter((entry) => entry.pattern.test(text)).map((entry) => ({
    label: entry.label,
    weight: entry.weight,
  }));
}

function analyzeVideo(video: BilibiliResolvedVideo, comments: BilibiliComment[]): BoundedJsonObject {
  const text = `${video.title}\n${video.description}`;
  const signals = signalMatches(text);
  const metrics = video.metrics;
  const play = numberFromObject(metrics, 'play');
  const interactions =
    numberFromObject(metrics, 'like') +
    numberFromObject(metrics, 'favorite') +
    numberFromObject(metrics, 'coin') +
    numberFromObject(metrics, 'share') +
    numberFromObject(metrics, 'comment');
  const engagementRate = play > 0 ? Number((interactions / play).toFixed(4)) : null;
  const commerceScore = Math.min(
    100,
    signals.reduce((sum, signal) => sum + numberFromObject(signal, 'weight') * 12, 0) +
      (engagementRate !== null && engagementRate >= 0.08 ? 16 : 0) +
      (comments.some((comment) => PURCHASE_INTENT_PATTERNS.some((pattern) => pattern.test(comment.text))) ? 18 : 0),
  );
  const recommendations: string[] = [];
  if (!signals.some((signal) => signal.label === 'commerce intent')) {
    recommendations.push('Add explicit commerce keywords to title, cover copy, or script when this is used for product research.');
  }
  if (engagementRate !== null && engagementRate < 0.03) {
    recommendations.push('Engagement is relatively low; compare against higher-like videos before using this as a creative reference.');
  }
  if (comments.length === 0) {
    recommendations.push('No comments were available in the sample, so audience intent still needs a comment scrape or manual review.');
  }
  if (recommendations.length === 0) {
    recommendations.push('Use the video as a reference candidate and continue with comment-level purchase intent checks.');
  }
  return {
    kind: 'metadata_comment_heuristic',
    commerceScore,
    engagementRate,
    interactions,
    matchedSignals: signals,
    summary:
      commerceScore >= 70
        ? 'Strong candidate for AI digital-human commerce research.'
        : commerceScore >= 40
          ? 'Moderate commerce relevance; validate with comments and downloaded footage.'
          : 'Weak commerce relevance based on title, description, metrics, and sampled comments.',
    recommendations,
  };
}

async function executeAnalyzeVideo(
  tool: ConnectorCatalogToolDefinition,
  input: BoundedJsonObject,
  credentials: ConnectorCredentialMaterial,
  context: VideoCrawlerExecutionOptions | undefined,
): Promise<BoundedJsonObject> {
  const video = await fetchVideoView(normalizeTarget(input), credentials, context);
  const includeComments = booleanInput(input, 'includeComments') ?? true;
  const commentsLimit = integerInput(input, 'commentsLimit', 20, 1, 100);
  const comments = includeComments
    ? (
        await fetchComments(
          { ...input, limit: commentsLimit } as BoundedJsonObject,
          credentials,
          context,
        )
      ).result.comments
    : [];
  const output: BoundedJsonObject = {
    ok: true,
    toolName: tool.name,
    provider: 'bilibili-web',
    video: {
      videoId: video.bvid,
      aid: video.aid,
      cid: video.cid,
      title: video.title,
      url: video.url,
      coverImage: video.coverImage,
      description: video.description,
      publishTime: video.publishTime,
      durationSeconds: video.durationSeconds,
      author: video.author,
      metrics: video.metrics,
      category: video.category,
    },
    sampledComments: comments.slice(0, 5) as unknown as BoundedJsonValue,
    analysis: analyzeVideo(video, comments),
  };
  const saved = await writeJsonArtifact(context, `video-analysis-${video.bvid}.json`, output);
  return saved === undefined ? output : { ...output, path: saved.path, absolutePath: saved.absolutePath };
}

function countMatches(comments: BilibiliComment[], patterns: RegExp[]): number {
  return comments.filter((comment) => patterns.some((pattern) => pattern.test(comment.text))).length;
}

function sentimentForComment(comment: BilibiliComment): 'positive' | 'negative' | 'neutral' {
  const positive = POSITIVE_PATTERNS.some((pattern) => pattern.test(comment.text));
  const negative = NEGATIVE_PATTERNS.some((pattern) => pattern.test(comment.text));
  if (positive && !negative) return 'positive';
  if (negative && !positive) return 'negative';
  return 'neutral';
}

function keywordCounts(comments: BilibiliComment[]): BoundedJsonValue[] {
  const dictionary = [
    '数字人',
    '带货',
    '直播',
    '链接',
    '价格',
    '教程',
    '工具',
    '效果',
    '变现',
    'AI',
    '橱窗',
    '购买',
  ];
  return dictionary
    .map((keyword) => ({
      keyword,
      count: comments.filter((comment) => comment.text.toLowerCase().includes(keyword.toLowerCase())).length,
    }))
    .filter((entry) => entry.count > 0)
    .sort((left, right) => right.count - left.count)
    .slice(0, 12);
}

function analyzeComments(comments: BilibiliComment[]): BoundedJsonObject {
  const sentimentCounts = comments.reduce(
    (counts, comment) => {
      const sentiment = sentimentForComment(comment);
      counts[sentiment] += 1;
      return counts;
    },
    { positive: 0, negative: 0, neutral: 0 },
  );
  const purchaseIntentCount = countMatches(comments, PURCHASE_INTENT_PATTERNS);
  const questionCount = countMatches(comments, QUESTION_PATTERNS);
  const priceConcernCount = countMatches(comments, PRICE_CONCERN_PATTERNS);
  const qualityConcernCount = countMatches(comments, QUALITY_CONCERN_PATTERNS);
  const topLiked = [...comments]
    .sort((left, right) => right.likeCount - left.likeCount)
    .slice(0, 5)
    .map((comment) => ({
      commentId: comment.commentId,
      text: comment.text,
      author: comment.author,
      likeCount: comment.likeCount,
    }));
  return {
    kind: 'comment_heuristic',
    totalAnalyzed: comments.length,
    sentiment: sentimentCounts,
    purchaseIntentCount,
    questionCount,
    priceConcernCount,
    qualityConcernCount,
    keywords: keywordCounts(comments),
    topLiked,
    summary:
      purchaseIntentCount > 0
        ? 'Comments contain direct purchase or link-seeking intent.'
        : questionCount > 0
          ? 'Comments contain questions, but purchase intent is not yet explicit.'
          : 'Comments do not show strong purchase intent in this sample.',
  };
}

async function executeAnalyzeComments(
  tool: ConnectorCatalogToolDefinition,
  input: BoundedJsonObject,
  credentials: ConnectorCredentialMaterial,
  context: VideoCrawlerExecutionOptions | undefined,
): Promise<BoundedJsonObject> {
  const { video, result } = await fetchComments(input, credentials, context);
  const output: BoundedJsonObject = {
    ok: true,
    toolName: tool.name,
    provider: 'bilibili-web',
    video: {
      videoId: video.bvid,
      aid: video.aid,
      title: video.title,
      url: video.url,
      metrics: video.metrics,
    },
    count: result.comments.length,
    totalAvailable: result.totalAvailable,
    nextCursor: result.nextCursor,
    analysis: analyzeComments(result.comments),
  };
  const saved = await writeJsonArtifact(context, `comments-analysis-${video.bvid}.json`, output);
  return saved === undefined ? output : { ...output, path: saved.path, absolutePath: saved.absolutePath };
}

export async function executeBuiltInBilibiliCrawlerTool({
  definition,
  tool,
  input,
  credentials,
  context,
}: ExecuteBilibiliCrawlerToolOptions): Promise<BoundedJsonObject> {
  if (definition.id !== 'bilibili') {
    throw new ConnectorServiceError(
      'CONNECTOR_EXECUTION_FAILED',
      'Built-in video crawler runtime only supports Bilibili',
      501,
      { connectorId: definition.id, toolName: tool.name },
    );
  }
  const providerToolId = tool.providerToolId ?? tool.name.split('.').at(-1) ?? tool.name;
  switch (providerToolId) {
    case 'bilibili_search_videos':
      return executeSearchVideos(tool, input, credentials, context);
    case 'bilibili_get_video':
      return executeGetVideo(tool, input, credentials, context);
    case 'bilibili_download_video':
      return executeDownloadVideo(tool, input, credentials, context);
    case 'bilibili_get_comments':
      return executeGetComments(tool, input, credentials, context);
    case 'bilibili_analyze_video':
      return executeAnalyzeVideo(tool, input, credentials, context);
    case 'bilibili_analyze_comments':
      return executeAnalyzeComments(tool, input, credentials, context);
    default:
      throw new ConnectorServiceError('CONNECTOR_TOOL_NOT_FOUND', 'Bilibili crawler tool is not implemented', 404, {
        connectorId: definition.id,
        toolName: tool.name,
      });
  }
}
