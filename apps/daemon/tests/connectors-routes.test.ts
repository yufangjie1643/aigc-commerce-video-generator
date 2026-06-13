import { existsSync, readFileSync } from "node:fs";
import { request as httpRequest, type Server } from "node:http";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COMPOSIO_LOGO_CACHE_MAX_ENTRIES } from "../src/connectors/routes.js";
import { startServer } from "../src/server.js";
import {
  ComposioConnectorProvider,
  composioConnectorProvider,
  getStaticComposioCatalogDefinitions
} from "../src/connectors/composio.js";
import type { ConnectorCatalogDefinition, ConnectorDetail } from "../src/connectors/catalog.js";
import { readComposioConfig, writeComposioConfig, type ComposioConfig } from "../src/connectors/composio-config.js";
import { deleteConnectorCredentialsByProvider } from "../src/connectors/service.js";
import { CHAT_TOOL_ENDPOINTS, CHAT_TOOL_OPERATIONS, toolTokenRegistry } from "../src/tool-tokens.js";

type JsonObject = Record<string, any>;
type StartedServer = { url: string; server: Server };
type DiscoveryRequestCounts = { authConfigs: number; createdAuthConfigs: number; toolkits: number; tools: number };
type Deferred = { promise: Promise<void>; resolve: () => void };
type ComposioRequestBody = JsonObject;
type FetchInput = Parameters<typeof fetch>[0];
type FetchReturn = Awaited<ReturnType<typeof fetch>>;
type ComposioLogoFetch = (
  parsed: URL,
  init: RequestInit | undefined,
  input: FetchInput
) => Promise<FetchReturn> | FetchReturn;

interface MockComposioFetchOptions {
  authConfigs?: JsonObject[];
  createAuthConfigResponse?: JsonObject;
  delayFirstAuthConfigs?: { started: Deferred; release: Deferred };
  delayFirstToolkits?: { started: Deferred; release: Deferred };
  logoFetch?: ComposioLogoFetch;
  linkResponse?:
    | JsonObject
    | Response
    | Array<JsonObject | Response>
    | ((requestBody: ComposioRequestBody) => JsonObject | Response);
  toolsFailureToolkits?: string[];
  toolkits?: JsonObject[];
}

interface JsonFetchResponse<TBody = JsonObject> {
  status: number;
  body: TBody;
}

interface HostHeaderResponse {
  status: number | undefined;
  body: string;
}

let server: Server | undefined;
let baseUrl = "";
let originalComposioConfig: ComposioConfig;
let originalVideoCrawlerBrowserMock: string | undefined;
const originalFetch = globalThis.fetch;
let lastComposioLinkRequest: ComposioRequestBody | undefined;
let lastComposioAuthConfigRequest: ComposioRequestBody | undefined;
let lastVideoCrawlerRequest: JsonObject | undefined;
let lastDouyinSearchRequest: URL | undefined;
let composioDiscoveryRequestCounts: DiscoveryRequestCounts;

const DOUYIN_SHARE_URL = "https://v.douyin.com/f_W144684oY/";
const DOUYIN_VIDEO_ID = "7637058398223259786";
const DOUYIN_SEARCH_VIDEO_ID = "7123456789012345678";
const DOUYIN_RESOLVED_URL = `https://www.iesdouyin.com/share/video/${DOUYIN_VIDEO_ID}/?from_ssr=1`;

function composioJson(body: JsonObject, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

const bilibiliVideoDetails: Record<string, JsonObject> = {
  BV1abcde1234: {
    aid: 987654321,
    bvid: "BV1abcde1234",
    cid: 112233,
    title: "AI 数字人带货闭环案例",
    desc: "拆解 AI 数字人直播带货的素材、脚本、成交转化流程。",
    pic: "//i0.hdslb.com/bfs/archive/cover.jpg",
    pubdate: 1717300800,
    duration: 245,
    tname: "科技",
    owner: { mid: 1001, name: "UP 主甲" },
    stat: {
      view: 123456,
      danmaku: 321,
      reply: 88,
      favorite: 3456,
      coin: 456,
      share: 789,
      like: 9876
    },
    pages: [
      {
        cid: 112233,
        page: 1,
        part: "P1",
        duration: 245,
        dimension: { width: 1920, height: 1080 }
      }
    ]
  },
  BV1abcde5678: {
    aid: 987654322,
    bvid: "BV1abcde5678",
    cid: 445566,
    title: "虚拟人直播工具复盘",
    desc: "复盘虚拟人直播工具的选品、脚本、互动和转化链路。",
    pic: "//i0.hdslb.com/bfs/archive/cover2.jpg",
    pubdate: 1717387200,
    duration: 188,
    tname: "电商",
    owner: { mid: 1002, name: "UP 主乙" },
    stat: {
      view: 8200,
      danmaku: 45,
      reply: 12,
      favorite: 456,
      coin: 78,
      share: 34,
      like: 678
    },
    pages: [
      {
        cid: 445566,
        page: 1,
        part: "P1",
        duration: 188,
        dimension: { width: 1920, height: 1080 }
      }
    ]
  },
  BV1public360: {
    aid: 987654323,
    bvid: "BV1public360",
    cid: 778899,
    title: "公共 360P 下载测试",
    desc: "无 cookie 公开测试视频。",
    pic: "//i0.hdslb.com/bfs/archive/cover3.jpg",
    pubdate: 1717473600,
    duration: 60,
    tname: "测试",
    owner: { mid: 1003, name: "UP 主丙" },
    stat: {
      view: 3600,
      danmaku: 16,
      reply: 6,
      favorite: 36,
      coin: 12,
      share: 8,
      like: 360
    },
    pages: [
      {
        cid: 778899,
        page: 1,
        part: "P1",
        duration: 60,
        dimension: { width: 1280, height: 720 }
      }
    ]
  }
};

function bilibiliVideoDetailFor(parsed: URL): JsonObject {
  const bvid = parsed.searchParams.get("bvid") ?? "";
  if (bilibiliVideoDetails[bvid]) return bilibiliVideoDetails[bvid];
  const aid = Number.parseInt(parsed.searchParams.get("aid") ?? "", 10);
  const fallback = bilibiliVideoDetails.BV1abcde1234;
  if (!fallback) throw new Error("missing primary Bilibili video fixture");
  return Object.values(bilibiliVideoDetails).find((video) => video.aid === aid) ?? fallback;
}

function bilibiliFixtureVideoBytes(bvid: string): Buffer {
  if (bvid === "BV1public360") return Buffer.from("fixture-video-public-360");
  return Buffer.from(bvid === "BV1abcde5678" ? "fixture-video-5678" : "fixture-video");
}

function douyinFixtureVideoBytes(): Buffer {
  return Buffer.from("fixture-douyin-video");
}

function mockBilibiliApiFetch(parsed: URL): Response {
  if (parsed.pathname === "/x/web-interface/search/type") {
    return composioJson({
      code: 0,
      data: {
        numResults: 2,
        result: [
          {
            aid: 987654321,
            bvid: "BV1abcde1234",
            title: '<em class="keyword">AI</em> 数字人带货拆解',
            author: "UP 主甲",
            mid: 1001,
            arcurl: "https://www.bilibili.com/video/BV1abcde1234/",
            pic: "//i0.hdslb.com/bfs/archive/cover.jpg",
            play: "12.3万",
            favorites: 3456,
            review: 88,
            video_review: 321,
            pubdate: 1717300800,
            description: "AI 数字人直播带货案例"
          },
          {
            aid: 987654322,
            bvid: "BV1abcde5678",
            title: "虚拟人直播工具复盘",
            author: "UP 主乙",
            mid: 1002,
            arcurl: "https://www.bilibili.com/video/BV1abcde5678/",
            pic: "//i0.hdslb.com/bfs/archive/cover2.jpg",
            play: 8200,
            favorites: 456,
            review: 12,
            video_review: 45,
            pubdate: 1717387200,
            description: "工具流程和直播间复盘"
          }
        ]
      }
    });
  }
  if (parsed.pathname === "/x/web-interface/view") {
    return composioJson({
      code: 0,
      data: bilibiliVideoDetailFor(parsed)
    });
  }
  if (parsed.pathname === "/x/player/playurl") {
    const video = bilibiliVideoDetailFor(parsed);
    const bvid = String(video.bvid ?? "BV1abcde1234");
    const body = bilibiliFixtureVideoBytes(bvid);
    const requestedQuality = Number.parseInt(parsed.searchParams.get("qn") ?? "", 10);
    const quality = requestedQuality === 16 ? 16 : 80;
    return composioJson({
      code: 0,
      data: {
        quality,
        format: "mp4",
        accept_quality: [80, 64, 32, 16],
        accept_description: ["高清 1080P", "高清 720P", "清晰 480P", "流畅 360P"],
        durl: [
          {
            url: `https://upos.example/video/${bvid}.mp4`,
            size: body.byteLength,
            length: Number(video.duration ?? 0) * 1000
          }
        ]
      }
    });
  }
  if (parsed.pathname === "/x/v2/reply") {
    return composioJson({
      code: 0,
      data: {
        page: { num: 1, size: 20, count: 2 },
        replies: [
          {
            rpid: 1,
            member: { mid: 2001, uname: "买家甲" },
            content: { message: "怎么买？求链接，数字人效果不错" },
            like: 20,
            rcount: 1,
            ctime: 1717387200
          },
          {
            rpid: 2,
            member: { mid: 2002, uname: "围观乙" },
            content: { message: "价格贵吗，会不会割韭菜？" },
            like: 5,
            rcount: 0,
            ctime: 1717390800
          }
        ]
      }
    });
  }
  return composioJson({ code: -404, message: `Unhandled Bilibili mock: ${parsed.pathname}` }, 404);
}

function mockDouyinPublicFetch(parsed: URL): Response {
  if (parsed.hostname === "www.douyin.com" && parsed.pathname === "/aweme/v1/web/general/search/single/") {
    lastDouyinSearchRequest = parsed;
    return composioJson({
      status_code: 0,
      data: [
        {
          type: 1,
          aweme_info: {
            aweme_id: DOUYIN_SEARCH_VIDEO_ID,
            desc: "初春穿搭 显瘦 158 小个子穿搭 带货",
            create_time: 1717473600,
            author: {
              uid: "douyin-author-1",
              sec_uid: "MS4wLjABAAAA-search-author",
              nickname: "微微爆爆爆"
            },
            statistics: {
              play_count: 123456,
              digg_count: 694,
              comment_count: 33,
              share_count: 11,
              collect_count: 42
            },
            video: {
              duration: 12345,
              cover: {
                url_list: ["https://p3-pc.douyinpic.com/img/search-cover.jpeg"]
              }
            }
          }
        },
        {
          type: 1,
          aweme_info: {
            aweme_id: "7123456789012345679",
            desc: "小个子通勤穿搭 直播间同款",
            create_time: 1717560000,
            author: { uid: "douyin-author-2", nickname: "穿搭研究所" },
            statistics: {
              play_count: 8200,
              digg_count: 128,
              comment_count: 9,
              share_count: 3,
              collect_count: 21
            },
            video: {
              duration: 9000,
              cover: {
                url_list: ["https://p3-pc.douyinpic.com/img/search-cover-2.jpeg"]
              }
            }
          }
        }
      ],
      cursor: 2,
      has_more: 0,
      total: 2
    });
  }
  if (parsed.hostname === "v.douyin.com" && parsed.pathname === "/f_W144684oY/") {
    return new Response(null, {
      status: 302,
      headers: { location: DOUYIN_RESOLVED_URL }
    });
  }
  if (parsed.hostname === "www.iesdouyin.com" && parsed.pathname === `/share/video/${DOUYIN_VIDEO_ID}/`) {
    return new Response(
      `<!doctype html><html><head><title>微微爆爆爆的作品</title></head><body><script>
        window.__ROUTER_DATA__ = {
          "loaderData": {
            "video": {
              "aweme_id": "${DOUYIN_VIDEO_ID}",
              "desc": "微微爆爆爆的作品 # 初春穿搭 # 显瘦 # 158小个子穿搭",
              "author": { "nickname": "微微爆爆爆" },
              "statistics": { "digg_count": 694, "comment_count": 33, "share_count": 11, "collect_count": 42 },
              "video": {
                "width": 1080,
                "height": 1920,
                "duration": 12345,
                "play_addr": {
                  "url_list": [
                    "https:\\u002F\\u002Fv.douyinstatic.com\\u002Fobj\\u002Ftos-cn-ve-2774\\u002Fdouyin-fixture-video.mp4"
                  ]
                }
              }
            }
          }
        };
      </script></body></html>`,
      { status: 200, headers: { "content-type": "text/html; charset=UTF-8" } }
    );
  }
  if (parsed.hostname === "v.douyinstatic.com" && parsed.pathname === "/obj/tos-cn-ve-2774/douyin-fixture-video.mp4") {
    const body = douyinFixtureVideoBytes();
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "video/mp4",
        "content-length": String(body.byteLength)
      }
    });
  }
  return composioJson({ code: -404, message: `Unhandled Douyin mock: ${parsed.toString()}` }, 404);
}

function createDeferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((innerResolve) => {
    resolve = () => innerResolve(undefined);
  });
  return { promise, resolve };
}

async function closeServer(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (!server) return resolve(undefined);
    server.close((error?: Error) => (error ? reject(error) : resolve(undefined)));
  });
  server = undefined;
}

function mockComposioFetch(options: MockComposioFetchOptions = {}): void {
  const {
    authConfigs = [{ id: "ac_github", status: "ENABLED", toolkit: { slug: "github" } }],
    createAuthConfigResponse,
    delayFirstAuthConfigs,
    delayFirstToolkits,
    logoFetch,
    linkResponse = { connected_account_id: "ca_github", status: "ACTIVE", account_label: "octocat@example.com" },
    toolsFailureToolkits = [],
    toolkits
  } = options;
  composioDiscoveryRequestCounts = { authConfigs: 0, createdAuthConfigs: 0, toolkits: 0, tools: 0 };
  vi.stubGlobal("fetch", async (input: FetchInput, init?: RequestInit): Promise<FetchReturn> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith("http://127.0.0.1:") || url.startsWith("http://localhost:")) {
      return originalFetch(input, init);
    }
    const parsed = new URL(url);
    if (parsed.hostname === "crawler.example" && parsed.pathname === "/api/video-crawler/execute") {
      lastVideoCrawlerRequest = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      return composioJson({
        ok: true,
        items: [{ videoId: "BV1", title: "Fixture video" }],
        nextCursor: null
      });
    }
    if (parsed.hostname === "api.bilibili.com") {
      return mockBilibiliApiFetch(parsed);
    }
    if (
      parsed.hostname === "v.douyin.com" ||
      parsed.hostname === "www.douyin.com" ||
      parsed.hostname === "www.iesdouyin.com" ||
      parsed.hostname === "v.douyinstatic.com"
    ) {
      return mockDouyinPublicFetch(parsed);
    }
    if (parsed.hostname === "upos.example") {
      const bvid = parsed.pathname.match(/(BV[0-9A-Za-z]+)\.mp4$/)?.[1] ?? "BV1abcde1234";
      const body = bilibiliFixtureVideoBytes(bvid);
      return new Response(body, {
        status: 200,
        headers: {
          "content-type": "video/mp4",
          "content-length": String(body.byteLength)
        }
      });
    }
    if (parsed.hostname === "logos.composio.dev") {
      if (logoFetch) return await logoFetch(parsed, init, input);
      return new Response('<svg xmlns="http://www.w3.org/2000/svg"></svg>', {
        status: 200,
        headers: { "content-type": "image/svg+xml" }
      });
    }
    if (parsed.pathname === "/api/v3/auth_configs") {
      composioDiscoveryRequestCounts.authConfigs += 1;
      if (delayFirstAuthConfigs && composioDiscoveryRequestCounts.authConfigs === 1) {
        delayFirstAuthConfigs.started.resolve();
        await delayFirstAuthConfigs.release.promise;
      }
      return composioJson({ items: authConfigs });
    }
    if (parsed.pathname === "/api/v3.1/auth_configs" && init?.method === "POST") {
      composioDiscoveryRequestCounts.createdAuthConfigs += 1;
      lastComposioAuthConfigRequest = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      const toolkitSlug = lastComposioAuthConfigRequest?.toolkit?.slug ?? "GITHUB";
      if (createAuthConfigResponse instanceof Response) return createAuthConfigResponse;
      return composioJson(
        createAuthConfigResponse ?? {
          id: `ac_${String(toolkitSlug).toLowerCase()}`,
          status: "ENABLED",
          toolkit: { slug: toolkitSlug }
        }
      );
    }
    if (parsed.pathname === "/api/v3.1/toolkits") {
      composioDiscoveryRequestCounts.toolkits += 1;
      if (delayFirstToolkits && composioDiscoveryRequestCounts.toolkits === 1) {
        delayFirstToolkits.started.resolve();
        await delayFirstToolkits.release.promise;
      }
      return composioJson({
        items: toolkits ?? [
          {
            slug: "github",
            name: "GitHub",
            description: "GitHub toolkit",
            categories: [{ name: "Developer" }],
            meta: { tools_count: 12 }
          },
          {
            slug: "youtube",
            name: "YouTube",
            description: "YouTube toolkit",
            categories: [{ name: "Video" }],
            meta: { tools_count: 7 }
          }
        ]
      });
    }
    if (
      parsed.pathname === "/api/v3.1/tools" &&
      toolsFailureToolkits.includes(parsed.searchParams.get("toolkit_slug") ?? "")
    ) {
      composioDiscoveryRequestCounts.tools += 1;
      return composioJson({ message: "Composio tools unavailable" }, 503);
    }
    if (parsed.pathname === "/api/v3.1/tools" && parsed.searchParams.get("toolkit_slug") === "github") {
      composioDiscoveryRequestCounts.tools += 1;
      return composioJson({
        items: [
          {
            slug: "GITHUB_SEARCH_REPOSITORIES",
            name: "Search repositories",
            description: "Search public and private repositories",
            toolkit: { slug: "github" },
            input_parameters: {
              type: "object",
              properties: { query: { type: "string" } },
              required: ["query"],
              additionalProperties: false
            },
            tags: ["read"]
          },
          {
            slug: "GITHUB_LIST_PULL_REQUESTS",
            name: "List pull requests",
            description: "List pull requests for a repository.",
            toolkit: { slug: "github" },
            input_parameters: { type: "object", additionalProperties: false },
            tags: ["read"]
          }
        ]
      });
    }
    if (parsed.pathname === "/api/v3.1/tools" && parsed.searchParams.get("toolkit_slug") === "youtube") {
      composioDiscoveryRequestCounts.tools += 1;
      const cursor = parsed.searchParams.get("cursor");
      return composioJson({
        items: cursor
          ? [
              {
                slug: "YOUTUBE_GET_VIDEO",
                name: "Get video",
                description: "Read a YouTube video.",
                toolkit: { slug: "youtube" },
                input_parameters: { type: "object", additionalProperties: false },
                tags: ["read"]
              }
            ]
          : [
              {
                slug: "YOUTUBE_SEARCH_VIDEOS",
                name: "Search videos",
                description: "Search YouTube videos.",
                toolkit: { slug: "youtube" },
                input_parameters: { type: "object", additionalProperties: false },
                tags: ["read"]
              }
            ],
        total_items: 7,
        ...(cursor ? {} : { next_cursor: "cursor_page_2" })
      });
    }
    if (parsed.pathname === "/api/v3.1/connected_accounts/link") {
      lastComposioLinkRequest = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      const nextLinkResponse =
        typeof linkResponse === "function"
          ? linkResponse(lastComposioLinkRequest ?? {})
          : Array.isArray(linkResponse)
            ? linkResponse.shift()
            : linkResponse;
      if (nextLinkResponse instanceof Response) return nextLinkResponse;
      return composioJson(nextLinkResponse ?? {});
    }
    if (parsed.pathname === "/api/v3/connected_accounts/ca_github") {
      return composioJson({
        connected_account_id: "ca_github",
        status: "ACTIVE",
        account_label: "octocat@example.com",
        toolkit: { slug: "github" },
        auth_config: { id: lastComposioLinkRequest?.auth_config_id ?? "ac_github" }
      });
    }
    if (parsed.pathname === "/api/v3/connected_accounts/ca_youtube") {
      return composioJson({
        connected_account_id: "ca_youtube",
        status: "ACTIVE",
        account_label: "youtube@example.com",
        toolkit: { slug: "youtube" },
        auth_config: { id: lastComposioLinkRequest?.auth_config_id ?? "ac_youtube" }
      });
    }
    if (parsed.pathname === "/api/v3/connected_accounts/ca_douyin") {
      return composioJson({
        connected_account_id: "ca_douyin",
        status: "ACTIVE",
        account_label: "douyin@example.com",
        toolkit: { slug: "douyin" },
        auth_config: { id: lastComposioLinkRequest?.auth_config_id ?? "ac_douyin" }
      });
    }
    if (parsed.pathname === "/api/v3.1/tools/execute/GITHUB_SEARCH_REPOSITORIES") {
      return composioJson({ successful: true, data: { results: [] }, log_id: "log_1" });
    }
    if (parsed.pathname === "/api/v3/connected_accounts/ca_github" && init?.method === "DELETE") {
      return composioJson({ ok: true });
    }
    return composioJson({ message: `Unhandled Composio mock: ${url}` }, 404);
  });
}

beforeEach(async () => {
  originalComposioConfig = readComposioConfig();
  originalVideoCrawlerBrowserMock = process.env.OD_VIDEO_CRAWLER_BROWSER_MOCK;
  process.env.OD_VIDEO_CRAWLER_BROWSER_MOCK = "1";
  lastComposioLinkRequest = undefined;
  lastComposioAuthConfigRequest = undefined;
  lastVideoCrawlerRequest = undefined;
  lastDouyinSearchRequest = undefined;
  mockComposioFetch();
  const started = (await startServer({ port: 0, returnServer: true })) as StartedServer;
  server = started.server;
  baseUrl = started.url;
  await jsonFetch(`${baseUrl}/api/connectors/composio/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey: "cmp_test" })
  });
});

afterEach(async () => {
  deleteConnectorCredentialsByProvider("composio");
  deleteConnectorCredentialsByProvider("video-crawler-cookie");
  writeComposioConfig(originalComposioConfig ?? { apiKey: "" });
  if (originalVideoCrawlerBrowserMock === undefined) delete process.env.OD_VIDEO_CRAWLER_BROWSER_MOCK;
  else process.env.OD_VIDEO_CRAWLER_BROWSER_MOCK = originalVideoCrawlerBrowserMock;
  composioConnectorProvider.clearDiscoveryCache();
  await new Promise<void>((resolve, reject) => {
    if (!server) return resolve(undefined);
    server.close((error?: Error) => (error ? reject(error) : resolve(undefined)));
  });
  server = undefined;
  toolTokenRegistry.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function jsonFetch<TBody = JsonObject>(url: string, init?: RequestInit): Promise<JsonFetchResponse<TBody>> {
  const response = await fetch(url, init);
  return { status: response.status, body: (await response.json()) as TBody };
}

async function requestWithHostHeader(
  method: string,
  url: string,
  host: string,
  body?: JsonObject
): Promise<HostHeaderResponse> {
  const target = new URL(url);
  return await new Promise<HostHeaderResponse>((resolve, reject) => {
    const req = httpRequest(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        method,
        headers: {
          host,
          ...(body === undefined ? {} : { "content-type": "application/json" })
        }
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString("utf8")
          });
        });
      }
    );
    req.on("error", reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

async function postWithHostHeader(url: string, host: string): Promise<HostHeaderResponse> {
  return requestWithHostHeader("POST", url, host);
}

async function putWithHostHeader(url: string, host: string, body: JsonObject): Promise<HostHeaderResponse> {
  return requestWithHostHeader("PUT", url, host, body);
}

function mintConnectorToolToken(
  projectId = "connector-route-project",
  runId = "connector-route-run",
  overrides: Partial<Parameters<typeof toolTokenRegistry.mint>[0]> = {}
): string {
  return toolTokenRegistry.mint({
    projectId,
    runId,
    allowedEndpoints: CHAT_TOOL_ENDPOINTS,
    allowedOperations: CHAT_TOOL_OPERATIONS,
    ...overrides
  }).token;
}

describe("connector routes", () => {
  it("lists catalog connectors without hitting Composio discovery endpoints", async () => {
    const response = await jsonFetch(`${baseUrl}/api/connectors`);

    expect(response.status).toBe(200);
    expect(response.body.connectors.map((connector: ConnectorDetail) => connector.id)).toEqual([
      "github",
      "youtube",
      "tiktok",
      "douyin",
      "bilibili"
    ]);
    const github = response.body.connectors.find((connector: ConnectorDetail) => connector.id === "github");
    expect(github).toMatchObject({
      id: "github",
      name: "GitHub",
      provider: "composio",
      toolCount: 2,
      auth: { provider: "composio", configured: false }
    });
    expect(github.tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "github.github_search_repositories" })])
    );
    expect(response.body.connectors.find((connector: ConnectorDetail) => connector.id === "youtube")).toMatchObject({
      id: "youtube",
      category: "Video",
      toolCount: 4,
      auth: { provider: "cookie", configured: false }
    });
    expect(response.body.connectors.find((connector: ConnectorDetail) => connector.id === "youtube")?.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "youtube.youtube_search_videos" }),
        expect.objectContaining({ name: "youtube.youtube_get_comments" })
      ])
    );
    expect(response.body.connectors.find((connector: ConnectorDetail) => connector.id === "douyin")).toMatchObject({
      id: "douyin",
      name: "抖音",
      category: "Video",
      toolCount: 4,
      auth: { provider: "cookie", configured: false }
    });
    expect(response.body.connectors.find((connector: ConnectorDetail) => connector.id === "bilibili")).toMatchObject({
      id: "bilibili",
      category: "Video",
      toolCount: 6,
      auth: { provider: "cookie", configured: false }
    });
    expect(response.body.connectors.find((connector: ConnectorDetail) => connector.id === "bilibili")?.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "bilibili.bilibili_search_videos" }),
        expect.objectContaining({ name: "bilibili.bilibili_download_video" }),
        expect.objectContaining({ name: "bilibili.bilibili_analyze_video" })
      ])
    );
    expect(composioDiscoveryRequestCounts).toEqual({ authConfigs: 0, createdAuthConfigs: 0, toolkits: 0, tools: 0 });
  });

  it("reuses fast Composio metadata discovery results without hydrating tools", async () => {
    const first = await jsonFetch(`${baseUrl}/api/connectors/discovery`);
    const second = await jsonFetch(`${baseUrl}/api/connectors/discovery`);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.connectors.map((connector: ConnectorDetail) => connector.id)).toEqual([
      "github",
      "youtube",
      "tiktok",
      "douyin",
      "bilibili"
    ]);
    expect(second.body.connectors.map((connector: ConnectorDetail) => connector.id)).toEqual([
      "github",
      "youtube",
      "tiktok",
      "douyin",
      "bilibili"
    ]);
    expect(first.body.connectors.find((connector: ConnectorDetail) => connector.id === "github")).toMatchObject({
      toolCount: 12
    });
    expect(first.body.connectors.find((connector: ConnectorDetail) => connector.id === "youtube")).toMatchObject({
      toolCount: 4,
      auth: { provider: "cookie" }
    });
    expect(first.body.connectors.find((connector: ConnectorDetail) => connector.id === "bilibili")?.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "bilibili.bilibili_get_comments" }),
        expect.objectContaining({ name: "bilibili.bilibili_analyze_comments" })
      ])
    );
    expect(first.body.meta).toMatchObject({ provider: "mixed" });
    expect(composioDiscoveryRequestCounts).toEqual({ authConfigs: 1, createdAuthConfigs: 0, toolkits: 1, tools: 0 });
  });

  it("preserves static advertised tool counts when live toolkit metadata omits counts", async () => {
    mockComposioFetch({
      toolkits: [
        {
          slug: "github",
          name: "GitHub",
          description: "GitHub toolkit",
          categories: [{ name: "Developer" }],
          meta: {}
        }
      ]
    });
    composioConnectorProvider.clearDiscoveryCache();

    const response = await jsonFetch(`${baseUrl}/api/connectors/discovery?refresh=true`);

    expect(response.status).toBe(200);
    expect(response.body.connectors.find((connector: ConnectorDetail) => connector.id === "github")).toMatchObject({
      id: "github",
      toolCount: 2
    });
    expect(composioDiscoveryRequestCounts).toEqual({ authConfigs: 1, createdAuthConfigs: 0, toolkits: 1, tools: 0 });
  });

  it("hydrates Composio tools only when explicitly requested", async () => {
    const response = await jsonFetch(`${baseUrl}/api/connectors/discovery?hydrateTools=true`);

    expect(response.status).toBe(200);
    expect(response.body.connectors.find((connector: ConnectorDetail) => connector.id === "github")?.tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "github.github_list_pull_requests" })])
    );
    expect(response.body.connectors.find((connector: ConnectorDetail) => connector.id === "youtube")?.tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "youtube.youtube_search_videos" })])
    );
    expect(response.body.connectors.find((connector: ConnectorDetail) => connector.id === "github")).toMatchObject({
      toolCount: 12
    });
    expect(composioDiscoveryRequestCounts).toEqual({ authConfigs: 1, createdAuthConfigs: 0, toolkits: 1, tools: 1 });
  });

  it("returns video crawler tool previews without Composio pagination", async () => {
    const metadata = await jsonFetch(`${baseUrl}/api/connectors/youtube`);
    const preview = await jsonFetch(`${baseUrl}/api/connectors/youtube?hydrateTools=true&toolsLimit=1`);

    expect(metadata.status).toBe(200);
    expect(metadata.body.connector).toMatchObject({ id: "youtube", toolCount: 4, auth: { provider: "cookie" } });
    expect(metadata.body.connector.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "youtube.youtube_search_videos" }),
        expect.objectContaining({ name: "youtube.youtube_get_comments" })
      ])
    );
    expect(preview.status).toBe(200);
    expect(preview.body.connector).toMatchObject({
      id: "youtube",
      toolCount: 4,
      tools: expect.arrayContaining([expect.objectContaining({ name: "youtube.youtube_download_video" })])
    });
    expect(preview.body.connector.toolsNextCursor).toBeUndefined();
    expect(preview.body.connector.toolsHasMore).toBeUndefined();
    expect(composioDiscoveryRequestCounts).toEqual({ authConfigs: 0, createdAuthConfigs: 0, toolkits: 0, tools: 0 });
  });

  it("propagates Composio tool page failures during preview hydration", async () => {
    mockComposioFetch({ toolsFailureToolkits: ["github"] });
    composioConnectorProvider.clearDiscoveryCache();

    const preview = await jsonFetch(`${baseUrl}/api/connectors/github?hydrateTools=true&toolsLimit=1`);

    expect(preview.status).toBe(502);
    expect(preview.body.error).toMatchObject({
      code: "CONNECTOR_EXECUTION_FAILED",
      message: "Composio tools unavailable"
    });
    expect(composioDiscoveryRequestCounts).toEqual({ authConfigs: 1, createdAuthConfigs: 0, toolkits: 1, tools: 1 });
  });

  it("returns connector statuses by connectorId", async () => {
    await jsonFetch(`${baseUrl}/api/connectors/github/connect`, { method: "POST" });

    const response = await jsonFetch(`${baseUrl}/api/connectors/status`);

    expect(response.status).toBe(200);
    expect(response.body.statuses.github).toMatchObject({ status: "connected", accountLabel: "octocat@example.com" });
    expect(response.body.statuses.youtube).toMatchObject({ status: "available" });
    expect(response.body.statuses.douyin).toMatchObject({ status: "available" });
  });

  it("returns static catalog connectors even when Composio auth configs are empty", async () => {
    await new Promise((resolve, reject) => {
      server!.close((error?: Error) => (error ? reject(error) : resolve(undefined)));
    });
    mockComposioFetch({
      authConfigs: [],
      linkResponse: { connected_account_id: "ca_youtube", status: "ACTIVE", account_label: "youtube@example.com" }
    });
    composioConnectorProvider.clearDiscoveryCache();
    const started = (await startServer({ port: 0, returnServer: true })) as StartedServer;
    server = started.server;
    baseUrl = started.url;
    await jsonFetch(`${baseUrl}/api/connectors/composio/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "cmp_test" })
    });

    const response = await jsonFetch(`${baseUrl}/api/connectors`);

    expect(response.status).toBe(200);
    expect(response.body.connectors.map((connector: ConnectorDetail) => connector.id)).toEqual([
      "github",
      "youtube",
      "tiktok",
      "douyin",
      "bilibili"
    ]);
    expect(response.body.connectors.every((connector: ConnectorDetail) => connector.auth?.configured === false)).toBe(
      true
    );
  });

  it("returns static catalog connectors before Composio is configured", async () => {
    writeComposioConfig({ apiKey: "" });
    composioConnectorProvider.clearDiscoveryCache();

    const response = await jsonFetch(`${baseUrl}/api/connectors`);

    expect(response.status).toBe(200);
    expect(response.body.connectors.map((connector: ConnectorDetail) => connector.id)).toEqual([
      "github",
      "youtube",
      "tiktok",
      "douyin",
      "bilibili"
    ]);
    expect(response.body.connectors.every((connector: ConnectorDetail) => connector.auth?.configured === false)).toBe(
      true
    );
  });

  it("returns connector detail and 404 for unknown connectors", async () => {
    const detail = await jsonFetch(`${baseUrl}/api/connectors/github`);

    expect(detail.status).toBe(200);
    expect(detail.body.connector).toMatchObject({ id: "github", name: "GitHub" });

    const missing = await jsonFetch(`${baseUrl}/api/connectors/missing`);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("CONNECTOR_NOT_FOUND");
  });

  it("connects and disconnects a Composio connector", async () => {
    const connect = await jsonFetch(`${baseUrl}/api/connectors/github/connect`, { method: "POST" });
    const afterConnect = { ...composioDiscoveryRequestCounts };

    expect(connect.status).toBe(200);
    expect(connect.body.connector).toMatchObject({
      id: "github",
      status: "connected",
      accountLabel: "octocat@example.com"
    });

    const disconnect = await jsonFetch(`${baseUrl}/api/connectors/github/connection`, { method: "DELETE" });
    expect(disconnect.status).toBe(200);
    expect(disconnect.body.connector).toMatchObject({ id: "github", status: "available" });
    expect(composioDiscoveryRequestCounts).toEqual(afterConnect);
  });

  it("rejects cross-origin connector connect requests before starting provider auth", async () => {
    const connect = await jsonFetch(`${baseUrl}/api/connectors/github/connect`, {
      method: "POST",
      headers: { Origin: "https://attacker.example" }
    });

    expect(connect.status).toBe(403);
    expect(JSON.stringify(connect.body.error)).toContain("Cross-origin");
    expect(lastComposioLinkRequest).toBeUndefined();
  });

  it("rejects Composio config updates from non-loopback daemon hosts", async () => {
    const response = await putWithHostHeader(`${baseUrl}/api/connectors/composio/config`, "example.com", {
      apiKey: "cmp_remote"
    });

    expect(response.status).toBe(403);
    expect(response.body).toContain("request host must be a loopback daemon address");
    expect(readComposioConfig().apiKey).toBe("cmp_test");
  });

  it("clears Composio connector credentials when rotating to a key with the same tail", async () => {
    const connect = await jsonFetch(`${baseUrl}/api/connectors/github/connect`, { method: "POST" });

    expect(connect.status).toBe(200);
    expect(connect.body.connector).toMatchObject({ id: "github", status: "connected" });

    const rotate = await jsonFetch(`${baseUrl}/api/connectors/composio/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "cmp_rotated_test" })
    });
    const statuses = await jsonFetch(`${baseUrl}/api/connectors/status`);

    expect(rotate.status).toBe(200);
    expect(rotate.body).toMatchObject({ configured: true, apiKeyTail: "test" });
    expect(statuses.body.statuses.github).toMatchObject({ status: "available" });
  });

  it("creates a managed Composio auth config when connecting an unconfigured connector", async () => {
    await new Promise((resolve, reject) => {
      server!.close((error?: Error) => (error ? reject(error) : resolve(undefined)));
    });
    mockComposioFetch({
      authConfigs: [],
      linkResponse: { connected_account_id: "ca_github", status: "ACTIVE", account_label: "octocat@example.com" }
    });
    composioConnectorProvider.clearDiscoveryCache();
    const started = (await startServer({ port: 0, returnServer: true })) as StartedServer;
    server = started.server;
    baseUrl = started.url;
    await jsonFetch(`${baseUrl}/api/connectors/composio/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "cmp_test" })
    });

    const connect = await jsonFetch(`${baseUrl}/api/connectors/github/connect`, { method: "POST" });
    expect(composioDiscoveryRequestCounts).toEqual({ authConfigs: 1, createdAuthConfigs: 1, toolkits: 0, tools: 0 });
    expect(readComposioConfig().authConfigIds.github).toBe("ac_github");

    const token = mintConnectorToolToken("connector-auto-auth-project", "connector-auto-auth-run");
    const tools = await jsonFetch(`${baseUrl}/api/tools/connectors/list`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    expect(connect.status).toBe(200);
    expect(connect.body.connector).toMatchObject({ id: "github", status: "connected", auth: { configured: true } });
    expect(connect.body.connector.tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "github.github_search_repositories" })])
    );
    expect(lastComposioAuthConfigRequest).toEqual({
      toolkit: { slug: "GITHUB" },
      auth_config: { type: "use_composio_managed_auth" }
    });
    expect(lastComposioLinkRequest).toMatchObject({ auth_config_id: "ac_github" });
    expect(tools.status).toBe(200);
    expect(tools.body.connectors.find((connector: ConnectorDetail) => connector.id === "github")?.tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "github.github_search_repositories" })])
    );
    expect(composioDiscoveryRequestCounts).toMatchObject({ authConfigs: 2, createdAuthConfigs: 1 });
  });

  it("reuses persisted Composio auth config ids on later connect attempts", async () => {
    await closeServer();
    mockComposioFetch({
      authConfigs: [],
      linkResponse: { connected_account_id: "ca_github", status: "ACTIVE", account_label: "octocat@example.com" }
    });
    composioConnectorProvider.clearDiscoveryCache();
    const started = (await startServer({ port: 0, returnServer: true })) as StartedServer;
    server = started.server;
    baseUrl = started.url;
    await jsonFetch(`${baseUrl}/api/connectors/composio/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "cmp_test" })
    });

    const first = await jsonFetch(`${baseUrl}/api/connectors/github/connect`, { method: "POST" });
    const afterFirst = { ...composioDiscoveryRequestCounts };
    const second = await jsonFetch(`${baseUrl}/api/connectors/github/connect`, { method: "POST" });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(readComposioConfig().authConfigIds.github).toBe("ac_github");
    expect(afterFirst).toEqual({ authConfigs: 1, createdAuthConfigs: 1, toolkits: 0, tools: 0 });
    expect(composioDiscoveryRequestCounts).toEqual(afterFirst);
    expect(lastComposioLinkRequest).toMatchObject({ auth_config_id: "ac_github" });
  });

  it("prepares a Composio auth config before connect and then reuses it for the link", async () => {
    await closeServer();
    mockComposioFetch({
      authConfigs: [],
      linkResponse: { connected_account_id: "ca_github", status: "ACTIVE", account_label: "octocat@example.com" }
    });
    composioConnectorProvider.clearDiscoveryCache();
    const started = (await startServer({ port: 0, returnServer: true })) as StartedServer;
    server = started.server;
    baseUrl = started.url;
    await jsonFetch(`${baseUrl}/api/connectors/composio/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "cmp_test" })
    });

    const prepare = await jsonFetch(`${baseUrl}/api/connectors/auth-configs/prepare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectorIds: ["github"] })
    });
    const afterPrepare = { ...composioDiscoveryRequestCounts };
    const connect = await jsonFetch(`${baseUrl}/api/connectors/github/connect`, { method: "POST" });

    expect(prepare.status).toBe(200);
    expect(prepare.body.results.github).toEqual({ status: "ready", authConfigId: "ac_github" });
    expect(readComposioConfig().authConfigIds.github).toBe("ac_github");
    expect(afterPrepare).toEqual({ authConfigs: 1, createdAuthConfigs: 1, toolkits: 0, tools: 0 });
    expect(connect.status).toBe(200);
    expect(composioDiscoveryRequestCounts).toEqual(afterPrepare);
    expect(lastComposioLinkRequest).toMatchObject({ auth_config_id: "ac_github" });
  });

  it("refreshes a stale persisted auth config id once when creating a link fails", async () => {
    await closeServer();
    mockComposioFetch({
      authConfigs: [{ id: "ac_github_fresh", status: "ENABLED", toolkit: { slug: "github" } }],
      linkResponse: (requestBody: ComposioRequestBody) =>
        requestBody.auth_config_id === "ac_github_stale"
          ? composioJson({ message: "stale auth config" }, 404)
          : { connected_account_id: "ca_github", status: "ACTIVE", account_label: "octocat@example.com" }
    });
    composioConnectorProvider.clearDiscoveryCache();
    const started = (await startServer({ port: 0, returnServer: true })) as StartedServer;
    server = started.server;
    baseUrl = started.url;
    writeComposioConfig({ apiKey: "cmp_test", authConfigIds: { github: "ac_github_stale" } });

    const connect = await jsonFetch(`${baseUrl}/api/connectors/github/connect`, { method: "POST" });

    expect(connect.status).toBe(200);
    expect(readComposioConfig().authConfigIds.github).toBe("ac_github_fresh");
    expect(composioDiscoveryRequestCounts).toEqual({ authConfigs: 1, createdAuthConfigs: 0, toolkits: 0, tools: 0 });
    expect(lastComposioLinkRequest).toMatchObject({ auth_config_id: "ac_github_fresh" });
  });

  it("marks Composio auth as configured from a persisted local auth config id", async () => {
    writeComposioConfig({ apiKey: "cmp_test", authConfigIds: { github: "ac_github" } });

    const response = await jsonFetch(`${baseUrl}/api/connectors`);

    expect(response.status).toBe(200);
    expect(response.body.connectors.find((connector: ConnectorDetail) => connector.id === "github")).toMatchObject({
      auth: { provider: "composio", configured: true }
    });
  });

  it("skips Composio auth config preparation for cookie crawler connectors", async () => {
    await closeServer();
    mockComposioFetch();
    composioConnectorProvider.clearDiscoveryCache();
    const started = (await startServer({ port: 0, returnServer: true })) as StartedServer;
    server = started.server;
    baseUrl = started.url;
    await jsonFetch(`${baseUrl}/api/connectors/composio/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "cmp_test" })
    });

    const prepare = await jsonFetch(`${baseUrl}/api/connectors/auth-configs/prepare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectorIds: ["douyin"] })
    });

    expect(prepare.status).toBe(200);
    expect(prepare.body.results.douyin).toEqual({
      status: "error",
      message: "connector is not backed by Composio"
    });
  });

  it("rediscovers externally-created Composio auth configs after managed auth is unavailable", async () => {
    await closeServer();
    const authConfigs: JsonObject[] = [];
    mockComposioFetch({
      authConfigs,
      createAuthConfigResponse: composioJson(
        {
          error: {
            message:
              'Default auth config not found for toolkit "github". Composio does not have managed credentials for this toolkit.',
            suggested_fix: 'Use type "use_custom_auth" with your own credentials.'
          }
        },
        400
      ),
      linkResponse: { connected_account_id: "ca_github", status: "PENDING" }
    });
    composioConnectorProvider.clearDiscoveryCache();
    const started = (await startServer({ port: 0, returnServer: true })) as StartedServer;
    server = started.server;
    baseUrl = started.url;
    await jsonFetch(`${baseUrl}/api/connectors/composio/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "cmp_test" })
    });

    const firstPrepare = await jsonFetch(`${baseUrl}/api/connectors/auth-configs/prepare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectorIds: ["github"] })
    });
    authConfigs.push({ id: "ac_github_custom", status: "ENABLED", toolkit: { slug: "github" } });
    const secondPrepare = await jsonFetch(`${baseUrl}/api/connectors/auth-configs/prepare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectorIds: ["github"] })
    });
    const connect = await jsonFetch(`${baseUrl}/api/connectors/github/connect`, { method: "POST" });

    expect(firstPrepare.status).toBe(200);
    expect(firstPrepare.body.results.github).toEqual({
      status: "custom_required",
      message:
        "GitHub requires a custom Composio auth config. Create or enable a GitHub auth config in Composio with your own OAuth credentials, then retry this connection."
    });
    expect(secondPrepare.status).toBe(200);
    expect(secondPrepare.body.results.github).toEqual({ status: "ready", authConfigId: "ac_github_custom" });
    expect(connect.status).toBe(200);
    expect(connect.body).toMatchObject({ auth: { kind: "pending", providerConnectionId: "ca_github" } });
    expect(connect.body.connector).toMatchObject({ id: "github", auth: { configured: true } });
    expect(readComposioConfig().authConfigIds.github).toBe("ac_github_custom");
    expect(lastComposioLinkRequest).toMatchObject({ auth_config_id: "ac_github_custom" });
    expect(composioDiscoveryRequestCounts).toEqual({ authConfigs: 2, createdAuthConfigs: 1, toolkits: 0, tools: 0 });
  });

  it("explains when a Composio connector requires a custom auth config", async () => {
    await closeServer();
    mockComposioFetch({
      authConfigs: [],
      createAuthConfigResponse: composioJson(
        {
          error: {
            message:
              'Default auth config not found for toolkit "github". Composio does not have managed credentials for this toolkit.',
            suggested_fix: 'Use type "use_custom_auth" with your own credentials.'
          }
        },
        400
      )
    });
    composioConnectorProvider.clearDiscoveryCache();
    const started = (await startServer({ port: 0, returnServer: true })) as StartedServer;
    server = started.server;
    baseUrl = started.url;
    await jsonFetch(`${baseUrl}/api/connectors/composio/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "cmp_test" })
    });

    const connect = await jsonFetch(`${baseUrl}/api/connectors/github/connect`, { method: "POST" });

    expect(connect.status).toBe(409);
    expect(connect.body.error.code).toBe("CONNECTOR_AUTH_CONFIG_REQUIRED");
    expect(connect.body.error.message).toBe(
      "GitHub requires a custom Composio auth config. Create or enable a GitHub auth config in Composio with your own OAuth credentials, then retry this connection."
    );
    expect(connect.body.error.details).toMatchObject({
      connectorId: "github",
      provider: "composio",
      reason: "managed_auth_unavailable",
      upstreamMessage:
        'Default auth config not found for toolkit "github". Composio does not have managed credentials for this toolkit.'
    });
  });

  it("rejects immediate Composio connections when account validation does not match the connector", async () => {
    await new Promise((resolve, reject) => {
      server!.close((error?: Error) => (error ? reject(error) : resolve(undefined)));
    });
    mockComposioFetch({
      authConfigs: [],
      linkResponse: { connected_account_id: "ca_youtube", status: "ACTIVE", account_label: "youtube@example.com" }
    });
    composioConnectorProvider.clearDiscoveryCache();
    const started = (await startServer({ port: 0, returnServer: true })) as StartedServer;
    server = started.server;
    baseUrl = started.url;
    await jsonFetch(`${baseUrl}/api/connectors/composio/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "cmp_test" })
    });

    const connect = await jsonFetch(`${baseUrl}/api/connectors/github/connect`, { method: "POST" });

    expect(connect.status).toBe(403);
    expect(connect.body.error.code).toBe("CONNECTOR_EXECUTION_FAILED");
  });

  it("does not let stale in-flight discovery overwrite a newly created auth config", async () => {
    const started = createDeferred();
    const release = createDeferred();
    await new Promise((resolve, reject) => {
      server!.close((error?: Error) => (error ? reject(error) : resolve(undefined)));
    });
    mockComposioFetch({
      authConfigs: [],
      delayFirstToolkits: { started, release },
      linkResponse: { connected_account_id: "ca_github", status: "ACTIVE", account_label: "octocat@example.com" }
    });
    composioConnectorProvider.clearDiscoveryCache();
    const restarted = (await startServer({ port: 0, returnServer: true })) as StartedServer;
    server = restarted.server;
    baseUrl = restarted.url;
    await jsonFetch(`${baseUrl}/api/connectors/composio/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "cmp_test" })
    });
    const staleDiscovery = composioConnectorProvider.listDefinitions(undefined, { hydrateTools: true });
    await started.promise;

    const github = getStaticComposioCatalogDefinitions().find(
      (connector: ConnectorCatalogDefinition) => connector.id === "github"
    );
    expect(github).toBeDefined();
    await composioConnectorProvider.connect(github!, `${baseUrl}/api/connectors/oauth/callback/github`);
    release.resolve();
    await staleDiscovery;

    const hydrated = await composioConnectorProvider.getHydratedDefinition("github");
    expect(hydrated?.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["github.github_search_repositories"])
    );
    expect(hydrated?.allowedToolNames).toEqual(expect.arrayContaining(["github.github_search_repositories"]));
  });

  it("TTL-prunes pending Composio OAuth states even if callbacks never arrive", async () => {
    mockComposioFetch({
      linkResponse: {
        connected_account_id: "ca_github",
        status: "INITIATED",
        redirect_url: "https://example.com/oauth"
      }
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-30T00:00:00.000Z"));
    const provider = new ComposioConnectorProvider();
    const github = getStaticComposioCatalogDefinitions().find(
      (connector: ConnectorCatalogDefinition) => connector.id === "github"
    );
    expect(github).toBeDefined();

    await provider.connect(github!, `${baseUrl}/api/connectors/oauth/callback/github`);
    expect((provider as unknown as { pendingConnections: Map<string, unknown> }).pendingConnections.size).toBe(1);

    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    await provider.connect(github!, `${baseUrl}/api/connectors/oauth/callback/github`);

    expect((provider as unknown as { pendingConnections: Map<string, unknown> }).pendingConnections.size).toBe(1);
  });

  it("returns branded callback HTML that notifies the opener", async () => {
    await new Promise((resolve, reject) => {
      if (!server) return resolve(undefined);
      server!.close((error?: Error) => (error ? reject(error) : resolve(undefined)));
    });
    mockComposioFetch({
      linkResponse: {
        connected_account_id: "ca_github",
        status: "INITIATED",
        redirect_url: "https://example.com/oauth"
      }
    });
    const started = (await startServer({ port: 0, returnServer: true })) as StartedServer;
    server = started.server;
    baseUrl = started.url;
    await jsonFetch(`${baseUrl}/api/connectors/composio/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "cmp_test" })
    });

    const connect = await jsonFetch(`${baseUrl}/api/connectors/github/connect`, { method: "POST" });
    expect(connect.status).toBe(200);
    expect(connect.body.auth).toMatchObject({ kind: "redirect_required" });
    expect(lastComposioLinkRequest).toBeDefined();
    const callbackUrl = new URL(String(lastComposioLinkRequest!.callback_url));
    const state = callbackUrl.searchParams.get("state");
    expect(state).not.toBeNull();

    const response = await fetch(
      `${baseUrl}/api/connectors/oauth/callback/github?state=${encodeURIComponent(state!)}&status=success&connected_account_id=ca_github`
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('<main aria-labelledby="callback-title">');
    expect(html).toContain("GitHub connected");
    expect(html).toContain("Open Design");
    expect(html).toContain("open-design:connector-connected");
    expect(html).toContain("function requestClose()");
    expect(html).toContain("Your browser blocked automatic closing. You can close this tab and return to Open Design.");
    expect(html).not.toContain("<p>Connector connected. You can close this window.</p>");
    expect(readComposioConfig().authConfigIds.github).toBe("ac_github");

    const duplicateResponse = await fetch(
      `${baseUrl}/api/connectors/oauth/callback/github?state=${encodeURIComponent(callbackUrl.searchParams.get("state") ?? "")}&status=success&connected_account_id=ca_github`
    );
    const duplicateHtml = await duplicateResponse.text();

    expect(duplicateResponse.status).toBe(200);
    expect(duplicateHtml).toContain("GitHub connected");
  });

  it("cancels pending Composio OAuth state before a stale callback can connect", async () => {
    await closeServer();
    mockComposioFetch({
      linkResponse: {
        connected_account_id: "ca_github",
        status: "INITIATED",
        redirect_url: "https://example.com/oauth"
      }
    });
    const started = (await startServer({ port: 0, returnServer: true })) as StartedServer;
    server = started.server;
    baseUrl = started.url;
    await jsonFetch(`${baseUrl}/api/connectors/composio/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "cmp_test" })
    });

    const connect = await jsonFetch(`${baseUrl}/api/connectors/github/connect`, { method: "POST" });
    expect(connect.status).toBe(200);
    expect(connect.body.auth).toMatchObject({ kind: "redirect_required" });
    const callbackUrl = new URL(lastComposioLinkRequest!.callback_url);

    const cancel = await jsonFetch(`${baseUrl}/api/connectors/github/authorization/cancel`, { method: "POST" });
    expect(cancel.status).toBe(200);
    expect(cancel.body.connector).toMatchObject({ id: "github", status: "available" });

    const staleCallback = await fetch(
      `${baseUrl}/api/connectors/oauth/callback/github?state=${encodeURIComponent(callbackUrl.searchParams.get("state") ?? "")}&status=success&connected_account_id=ca_github`
    );
    const stalePayload = (await staleCallback.json()) as JsonObject;

    expect(staleCallback.status).toBe(400);
    expect(stalePayload.error.message).toBe("Composio OAuth state is missing or expired");
    const statuses = await jsonFetch(`${baseUrl}/api/connectors/status`);
    expect(statuses.body.statuses.github?.status).not.toBe("connected");
  });

  it("accepts bracketed IPv6 loopback host headers for connector callback URLs", async () => {
    const url = new URL(baseUrl);

    const response = await postWithHostHeader(`${baseUrl}/api/connectors/github/connect`, `[::1]:${url.port}`);

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body).auth).toMatchObject({ kind: "connected" });
    expect(lastComposioLinkRequest?.callback_url).toContain(`[::1]:${url.port}/api/connectors/oauth/callback`);
  });

  it("accepts IPv4 loopback alias host headers for connector callback URLs", async () => {
    const url = new URL(baseUrl);

    const response = await postWithHostHeader(`${baseUrl}/api/connectors/github/connect`, `127.0.0.2:${url.port}`);

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body).auth).toMatchObject({ kind: "connected" });
    expect(lastComposioLinkRequest?.callback_url).toContain(`127.0.0.2:${url.port}/api/connectors/oauth/callback`);
  });

  it("times out stalled Composio logo fetches and clears the inflight entry", async () => {
    let upstreamRequests = 0;
    let firstRequestAborted = false;
    mockComposioFetch({
      logoFetch: async (_parsed, init) => {
        upstreamRequests += 1;
        if (upstreamRequests === 1) {
          await new Promise((_, reject) => {
            if (!init?.signal) {
              reject(new Error("expected fetch timeout signal"));
              return;
            }
            const abort = () => {
              firstRequestAborted = true;
              reject(init.signal?.reason ?? new DOMException("Aborted", "AbortError"));
            };
            if (init.signal.aborted) {
              abort();
              return;
            }
            init.signal.addEventListener("abort", abort, { once: true });
          });
        }
        return new Response(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), {
          status: 200,
          headers: { "content-type": "image/png" }
        });
      }
    });

    const firstRequestPromise = fetch(`${baseUrl}/api/connectors/logos/github?theme=dark`);
    const firstResponse = await firstRequestPromise;

    expect(firstRequestAborted).toBe(true);
    expect(firstResponse.status).toBe(404);

    const secondResponse = await fetch(`${baseUrl}/api/connectors/logos/github?theme=dark`);

    expect(secondResponse.status).toBe(200);
    expect(secondResponse.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await secondResponse.arrayBuffer())).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(upstreamRequests).toBe(2);
  }, 15_000);

  it("keeps the Composio logo timeout active while reading the response body", async () => {
    let upstreamRequests = 0;
    let firstBodyReadAborted = false;
    const slug = "body_timeout_logo";
    mockComposioFetch({
      logoFetch: async (_parsed, init) => {
        upstreamRequests += 1;
        if (upstreamRequests === 1) {
          return {
            ok: true,
            headers: new Headers({ "content-type": "image/png" }),
            arrayBuffer: async () => {
              await new Promise((resolve) => setTimeout(resolve, 2_100));
              if (!init?.signal) throw new Error("expected fetch timeout signal");
              if (init.signal.aborted) {
                firstBodyReadAborted = true;
                throw init.signal.reason ?? new DOMException("Aborted", "AbortError");
              }
              return Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
            }
          } as unknown as Response;
        }
        return new Response(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), {
          status: 200,
          headers: { "content-type": "image/png" }
        });
      }
    });

    const firstResponse = await fetch(`${baseUrl}/api/connectors/logos/${slug}?theme=dark`);

    expect(firstBodyReadAborted).toBe(true);
    expect(firstResponse.status).toBe(404);

    const secondResponse = await fetch(`${baseUrl}/api/connectors/logos/${slug}?theme=dark`);

    expect(secondResponse.status).toBe(200);
    expect(secondResponse.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await secondResponse.arrayBuffer())).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(upstreamRequests).toBe(2);
  }, 15_000);

  it("rejects oversized Composio logo payloads before buffering them", async () => {
    let upstreamRequests = 0;
    let arrayBufferCalled = false;
    const slug = "oversized_logo";
    mockComposioFetch({
      logoFetch: async () => {
        upstreamRequests += 1;
        if (upstreamRequests === 1) {
          return {
            ok: true,
            headers: new Headers({
              "content-type": "image/png",
              "content-length": "1048577"
            }),
            arrayBuffer: async () => {
              arrayBufferCalled = true;
              return Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
            }
          } as unknown as Response;
        }
        return new Response(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), {
          status: 200,
          headers: { "content-type": "image/png" }
        });
      }
    });

    const firstResponse = await fetch(`${baseUrl}/api/connectors/logos/${slug}?theme=dark`);

    expect(firstResponse.status).toBe(404);
    expect(firstResponse.headers.get("cache-control")).toBe("no-store");
    expect(arrayBufferCalled).toBe(false);

    const secondResponse = await fetch(`${baseUrl}/api/connectors/logos/${slug}?theme=dark`);

    expect(secondResponse.status).toBe(200);
    expect(secondResponse.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await secondResponse.arrayBuffer())).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(upstreamRequests).toBe(2);
  });

  it("evicts the least recently used Composio logo cache entry when the cache is full", async () => {
    let upstreamRequests = 0;
    mockComposioFetch({
      logoFetch: async (parsed) => {
        upstreamRequests += 1;
        return new Response(Buffer.from(parsed.pathname), {
          status: 200,
          headers: { "content-type": "image/png" }
        });
      }
    });

    for (let index = 0; index < COMPOSIO_LOGO_CACHE_MAX_ENTRIES; index += 1) {
      const response = await fetch(`${baseUrl}/api/connectors/logos/slug_${index}?theme=dark`);
      expect(response.status).toBe(200);
    }

    const warmedCount = upstreamRequests;

    const refreshedResponse = await fetch(`${baseUrl}/api/connectors/logos/slug_0?theme=dark`);
    expect(refreshedResponse.status).toBe(200);
    expect(upstreamRequests).toBe(warmedCount);

    const overflowResponse = await fetch(`${baseUrl}/api/connectors/logos/slug_overflow?theme=dark`);
    expect(overflowResponse.status).toBe(200);
    expect(upstreamRequests).toBe(warmedCount + 1);

    const stillCachedResponse = await fetch(`${baseUrl}/api/connectors/logos/slug_0?theme=dark`);
    expect(stillCachedResponse.status).toBe(200);
    expect(upstreamRequests).toBe(warmedCount + 1);

    const evictedResponse = await fetch(`${baseUrl}/api/connectors/logos/slug_1?theme=dark`);
    expect(evictedResponse.status).toBe(200);
    expect(upstreamRequests).toBe(warmedCount + 2);
  });

  it("serves raster Composio logo responses", async () => {
    mockComposioFetch({
      logoFetch: async () => {
        return new Response(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), {
          status: 200,
          headers: { "content-type": "image/png" }
        });
      }
    });

    const response = await fetch(`${baseUrl}/api/connectors/logos/github?theme=dark`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  });

  it("serves SVG Composio logo responses with a restrictive CSP", async () => {
    let upstreamRequests = 0;
    const slug = "svg_only_logo";
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';
    mockComposioFetch({
      logoFetch: async () => {
        upstreamRequests += 1;
        return new Response(svg, {
          status: 200,
          headers: { "content-type": "image/svg+xml" }
        });
      }
    });

    const firstResponse = await fetch(`${baseUrl}/api/connectors/logos/${slug}?theme=dark`);

    expect(firstResponse.status).toBe(200);
    expect(firstResponse.headers.get("content-type")).toBe("image/svg+xml");
    expect(firstResponse.headers.get("content-security-policy")).toBe(
      "default-src 'none'; img-src data:; style-src 'unsafe-inline'"
    );
    expect(await firstResponse.text()).toBe(svg);

    const secondResponse = await fetch(`${baseUrl}/api/connectors/logos/${slug}?theme=dark`);

    expect(secondResponse.status).toBe(200);
    expect(secondResponse.headers.get("content-type")).toBe("image/svg+xml");
    expect(await secondResponse.text()).toBe(svg);
    expect(upstreamRequests).toBe(1);
  });

  it("rejects non-image Composio logo responses without caching them", async () => {
    let upstreamRequests = 0;
    const slug = "html_only_logo";
    mockComposioFetch({
      logoFetch: async () => {
        upstreamRequests += 1;
        if (upstreamRequests === 1) {
          return new Response("<html><body>oops</body></html>", {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" }
          });
        }
        return new Response(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), {
          status: 200,
          headers: { "content-type": "image/png" }
        });
      }
    });

    const firstResponse = await fetch(`${baseUrl}/api/connectors/logos/${slug}?theme=dark`);

    expect(firstResponse.status).toBe(404);
    expect(firstResponse.headers.get("cache-control")).toBe("no-store");

    const secondResponse = await fetch(`${baseUrl}/api/connectors/logos/${slug}?theme=dark`);

    expect(secondResponse.status).toBe(200);
    expect(secondResponse.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await secondResponse.arrayBuffer())).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(upstreamRequests).toBe(2);
  });

  it("lists connected Composio tools through run-scoped tool auth", async () => {
    await jsonFetch(`${baseUrl}/api/connectors/github/connect`, { method: "POST" });
    const token = mintConnectorToolToken();
    composioDiscoveryRequestCounts = { authConfigs: 0, createdAuthConfigs: 0, toolkits: 0, tools: 0 };

    const response = await jsonFetch(`${baseUrl}/api/tools/connectors/list`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    expect(response.status).toBe(200);
    expect(response.body.connectors.map((connector: ConnectorDetail) => connector.id)).toEqual(["github"]);
    expect(response.body.connectors[0].tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "github.github_search_repositories",
          safety: expect.objectContaining({ sideEffect: "read", approval: "auto", reason: expect.any(String) })
        })
      ])
    );
    expect(composioDiscoveryRequestCounts).toEqual({ authConfigs: 1, createdAuthConfigs: 0, toolkits: 1, tools: 1 });
  });

  it("connects video crawler connectors with cookie credentials and lists crawler tools", async () => {
    const login = await jsonFetch(`${baseUrl}/api/connectors/bilibili/connect`, { method: "POST" });

    expect(login.status).toBe(200);
    expect(login.body.auth).toMatchObject({
      kind: "pending",
      providerConnectionId: expect.stringMatching(/^browser_bilibili_/)
    });
    expect(login.body.connector).toMatchObject({
      id: "bilibili",
      status: "available",
      auth: { provider: "cookie", configured: false }
    });

    const connect = await jsonFetch(`${baseUrl}/api/connectors/bilibili/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        credentials: {
          cookie: "SESSDATA=test_cookie;",
          userAgent: "Mozilla/5.0",
          accountLabel: "bilibili-user"
        }
      })
    });
    const token = mintConnectorToolToken("connector-video-crawler-project", "connector-video-crawler-run");
    const tools = await jsonFetch(`${baseUrl}/api/tools/connectors/list`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    expect(connect.status).toBe(200);
    expect(connect.body.connector).toMatchObject({
      id: "bilibili",
      status: "connected",
      accountLabel: "bilibili-user",
      auth: { provider: "cookie", configured: true }
    });
    expect(tools.status).toBe(200);
    expect(tools.body.connectors.map((connector: ConnectorDetail) => connector.id)).toEqual(["bilibili"]);
    expect(tools.body.connectors[0].tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "bilibili.bilibili_search_videos" }),
        expect.objectContaining({ name: "bilibili.bilibili_download_video" }),
        expect.objectContaining({ name: "bilibili.bilibili_get_comments" }),
        expect.objectContaining({ name: "bilibili.bilibili_analyze_video" }),
        expect.objectContaining({ name: "bilibili.bilibili_analyze_comments" })
      ])
    );
  });

  it("captures video crawler cookies from a controlled browser login", async () => {
    const login = await jsonFetch(`${baseUrl}/api/connectors/bilibili/connect`, { method: "POST" });
    const capture = await jsonFetch(`${baseUrl}/api/connectors/bilibili/authorization/capture`, { method: "POST" });
    const token = mintConnectorToolToken("connector-video-capture-project", "connector-video-capture-run");
    const tools = await jsonFetch(`${baseUrl}/api/tools/connectors/list`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    expect(login.status).toBe(200);
    expect(login.body.auth).toMatchObject({
      kind: "pending",
      providerConnectionId: expect.stringMatching(/^browser_bilibili_/)
    });
    expect(capture.status).toBe(200);
    expect(capture.body.connector).toMatchObject({
      id: "bilibili",
      status: "connected",
      accountLabel: "Bilibili browser session",
      auth: { provider: "cookie", configured: true }
    });
    expect(tools.status).toBe(200);
    expect(tools.body.connectors.map((connector: ConnectorDetail) => connector.id)).toEqual(["bilibili"]);
    expect(tools.body.connectors[0].tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "bilibili.bilibili_search_videos" }),
        expect.objectContaining({ name: "bilibili.bilibili_get_comments" }),
        expect.objectContaining({ name: "bilibili.bilibili_analyze_comments" })
      ])
    );
  });

  it("hydrates connected Composio tools when the fast definition only has partial static previews", async () => {
    await closeServer();
    mockComposioFetch({
      authConfigs: [{ id: "ac_github", status: "ENABLED", toolkit: { slug: "github" } }],
      linkResponse: { connected_account_id: "ca_github", status: "ACTIVE", account_label: "octocat@example.com" },
      toolkits: [
        {
          slug: "github",
          name: "GitHub",
          description: "GitHub toolkit",
          categories: [{ name: "Developer" }],
          meta: { tools_count: 12 }
        }
      ]
    });
    composioConnectorProvider.clearDiscoveryCache();
    const started = (await startServer({ port: 0, returnServer: true })) as StartedServer;
    server = started.server;
    baseUrl = started.url;
    await jsonFetch(`${baseUrl}/api/connectors/composio/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "cmp_test" })
    });
    await jsonFetch(`${baseUrl}/api/connectors/github/connect`, { method: "POST" });
    const token = mintConnectorToolToken("connector-partial-preview-project", "connector-partial-preview-run");
    composioDiscoveryRequestCounts = { authConfigs: 0, createdAuthConfigs: 0, toolkits: 0, tools: 0 };

    const response = await jsonFetch(`${baseUrl}/api/tools/connectors/list`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    expect(response.status).toBe(200);
    expect(response.body.connectors.map((connector: ConnectorDetail) => connector.id)).toEqual(["github"]);
    expect(response.body.connectors[0].tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "github.github_search_repositories" }),
        expect.objectContaining({
          name: "github.github_get_issue",
          safety: expect.objectContaining({ sideEffect: "read", approval: "auto" }),
          curation: expect.objectContaining({ useCases: ["personal_daily_digest"] })
        }),
        expect.objectContaining({ name: "github.github_list_pull_requests" })
      ])
    );
    expect(composioDiscoveryRequestCounts.tools).toBe(1);
  });

  it("filters connected connector tools by curated use case and returns curation metadata", async () => {
    await new Promise((resolve, reject) => {
      server!.close((error?: Error) => (error ? reject(error) : resolve(undefined)));
    });
    mockComposioFetch({
      authConfigs: [{ id: "ac_github", status: "ENABLED", toolkit: { slug: "github" } }],
      linkResponse: { connected_account_id: "ca_github", status: "ACTIVE", account_label: "octocat@example.com" }
    });
    composioConnectorProvider.clearDiscoveryCache();
    const started = (await startServer({ port: 0, returnServer: true })) as StartedServer;
    server = started.server;
    baseUrl = started.url;
    await jsonFetch(`${baseUrl}/api/connectors/composio/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "cmp_test" })
    });
    await jsonFetch(`${baseUrl}/api/connectors/github/connect`, { method: "POST" });
    const token = mintConnectorToolToken();

    const response = await jsonFetch(`${baseUrl}/api/tools/connectors/list?useCase=personal_daily_digest`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    expect(response.status).toBe(200);
    expect(response.body.connectors.map((connector: ConnectorDetail) => connector.id)).toEqual(["github"]);
    expect(response.body.connectors[0].tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "github.github_get_issue",
          curation: expect.objectContaining({ useCases: ["personal_daily_digest"] })
        }),
        expect.objectContaining({
          name: "github.github_list_pull_requests",
          curation: expect.objectContaining({ useCases: ["personal_daily_digest"] })
        })
      ])
    );
  });

  it("rejects invalid connector tool useCase filters", async () => {
    const token = mintConnectorToolToken();

    const response = await jsonFetch(`${baseUrl}/api/tools/connectors/list?useCase=invalid`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("BAD_REQUEST");
  });

  it("executes connected Composio tools through run-scoped tool auth", async () => {
    await jsonFetch(`${baseUrl}/api/connectors/github/connect`, { method: "POST" });
    const token = mintConnectorToolToken("connector-execute-project", "connector-execute-run");

    const response = await jsonFetch(`${baseUrl}/api/tools/connectors/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        connectorId: "github",
        toolName: "github.github_search_repositories",
        input: { query: "open-design" }
      })
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      connectorId: "github",
      accountLabel: "octocat@example.com",
      toolName: "github.github_search_repositories"
    });
    expect(response.body.output).toMatchObject({
      toolName: "github.github_search_repositories",
      providerToolId: "GITHUB_SEARCH_REPOSITORIES",
      data: { results: [] }
    });
  });

  it("executes connected video crawler tools through run-scoped tool auth", async () => {
    await jsonFetch(`${baseUrl}/api/connectors/bilibili/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        credentials: {
          cookie: "SESSDATA=test_cookie;",
          userAgent: "Mozilla/5.0",
          accountLabel: "bilibili-user"
        }
      })
    });
    const token = mintConnectorToolToken("connector-video-execute-project", "connector-video-execute-run");
    const originalCrawlerUrl = process.env.OD_VIDEO_CRAWLER_URL;
    process.env.OD_VIDEO_CRAWLER_URL = "https://crawler.example";
    try {
      const response = await jsonFetch(`${baseUrl}/api/tools/connectors/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          connectorId: "bilibili",
          toolName: "bilibili.bilibili_search_videos",
          input: { query: "open-design", limit: 2 }
        })
      });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        ok: true,
        connectorId: "bilibili",
        accountLabel: "bilibili-user",
        toolName: "bilibili.bilibili_search_videos",
        output: {
          ok: true,
          items: [expect.objectContaining({ videoId: "BV1" })]
        }
      });
      expect(lastVideoCrawlerRequest).toMatchObject({
        connectorId: "bilibili",
        toolName: "bilibili.bilibili_search_videos",
        providerToolId: "bilibili_search_videos",
        input: { query: "open-design", limit: 2 },
        credentials: {
          provider: "video-crawler-cookie",
          platform: "bilibili",
          cookie: "SESSDATA=test_cookie;",
          userAgent: "Mozilla/5.0"
        }
      });
    } finally {
      if (originalCrawlerUrl === undefined) delete process.env.OD_VIDEO_CRAWLER_URL;
      else process.env.OD_VIDEO_CRAWLER_URL = originalCrawlerUrl;
    }
  });

  it("runs the built-in Bilibili crawler workflow without an external crawler bridge", async () => {
    await jsonFetch(`${baseUrl}/api/connectors/bilibili/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        credentials: {
          cookie: "SESSDATA=test_cookie;",
          userAgent: "Mozilla/5.0",
          accountLabel: "bilibili-user"
        }
      })
    });
    const token = mintConnectorToolToken("connector-bilibili-workflow-project", "connector-bilibili-workflow-run");
    const originalCrawlerUrl = process.env.OD_VIDEO_CRAWLER_URL;
    delete process.env.OD_VIDEO_CRAWLER_URL;
    const execute = async (toolName: string, input: JsonObject) =>
      await jsonFetch(`${baseUrl}/api/tools/connectors/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          connectorId: "bilibili",
          toolName,
          input
        })
      });

    try {
      const search = await execute("bilibili.bilibili_search_videos", { query: "AI 数字人 带货", limit: 20 });
      const detail = await execute("bilibili.bilibili_get_video", { videoId: "BV1abcde1234" });
      const comments = await execute("bilibili.bilibili_get_comments", { videoId: "BV1abcde1234", limit: 20 });
      const download = await execute("bilibili.bilibili_download_video", {
        videoId: "BV1abcde1234",
        resolution: "1080p"
      });
      const videoAnalysis = await execute("bilibili.bilibili_analyze_video", {
        videoId: "BV1abcde1234",
        commentsLimit: 20
      });
      const commentAnalysis = await execute("bilibili.bilibili_analyze_comments", {
        videoId: "BV1abcde1234",
        limit: 20
      });

      expect(search.status).toBe(200);
      expect(search.body.output).toMatchObject({
        ok: true,
        provider: "bilibili-web",
        count: 2
      });
      expect(search.body.output.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            videoId: "BV1abcde1234",
            title: "AI 数字人带货拆解",
            metrics: expect.objectContaining({ play: 123000, favorite: 3456, comment: 88 })
          })
        ])
      );
      expect(detail.status).toBe(200);
      expect(detail.body.output.video).toMatchObject({
        videoId: "BV1abcde1234",
        aid: 987654321,
        cid: 112233,
        metrics: expect.objectContaining({ play: 123456, like: 9876, favorite: 3456 }),
        availableResolutions: expect.arrayContaining([expect.objectContaining({ quality: 80 })])
      });
      expect(comments.status).toBe(200);
      expect(comments.body.output).toMatchObject({
        count: 2,
        comments: [
          expect.objectContaining({ text: "怎么买？求链接，数字人效果不错", likeCount: 20 }),
          expect.objectContaining({ text: "价格贵吗，会不会割韭菜？", likeCount: 5 })
        ]
      });
      expect(existsSync(comments.body.output.absolutePath)).toBe(true);
      expect(download.status).toBe(200);
      expect(download.body.output).toMatchObject({
        path: expect.stringMatching(/^video-crawler\//),
        savedBytes: Buffer.byteLength("fixture-video"),
        selectedQuality: 80,
        format: "mp4"
      });
      expect(existsSync(download.body.output.absolutePath)).toBe(true);
      expect(readFileSync(download.body.output.absolutePath, "utf8")).toBe("fixture-video");
      expect(videoAnalysis.status).toBe(200);
      expect(videoAnalysis.body.output.analysis).toMatchObject({
        kind: "metadata_comment_heuristic",
        commerceScore: expect.any(Number),
        matchedSignals: expect.arrayContaining([expect.objectContaining({ label: "AI digital human" })])
      });
      expect(existsSync(videoAnalysis.body.output.absolutePath)).toBe(true);
      expect(commentAnalysis.status).toBe(200);
      expect(commentAnalysis.body.output.analysis).toMatchObject({
        kind: "comment_heuristic",
        totalAnalyzed: 2,
        purchaseIntentCount: 2,
        priceConcernCount: 1,
        qualityConcernCount: 1
      });
      expect(existsSync(commentAnalysis.body.output.absolutePath)).toBe(true);
      expect(lastVideoCrawlerRequest).toBeUndefined();
    } finally {
      if (originalCrawlerUrl === undefined) delete process.env.OD_VIDEO_CRAWLER_URL;
      else process.env.OD_VIDEO_CRAWLER_URL = originalCrawlerUrl;
    }
  });

  it("deletes a commerce video asset from the asset library", async () => {
    const created = await jsonFetch(`${baseUrl}/api/asset-library/commerce-videos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "待删除带货视频",
        sourceUrl: "https://www.bilibili.com/video/BVdelete0001/",
        product: { subject: "衬衫裙", category: "服饰" },
        video: { summary: "测试视频摘要" },
        methodology: { hooks: ["开场痛点"], structure: ["痛点", "展示", "CTA"] }
      })
    });

    expect(created.status).toBe(201);
    const id = String(created.body.video.id);

    const deleted = await jsonFetch(`${baseUrl}/api/asset-library/commerce-videos/${id}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    expect(deleted.body).toMatchObject({
      removedFiles: true,
      video: { id, title: "待删除带货视频" }
    });

    const missing = await jsonFetch(`${baseUrl}/api/asset-library/commerce-videos/${id}`);
    expect(missing.status).toBe(404);
  });

  it("rejects commerce video assets without source data", async () => {
    const response = await jsonFetch(`${baseUrl}/api/asset-library/commerce-videos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "缺少视频源的带货视频",
        product: { subject: "衬衫裙", category: "服饰" }
      })
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("sourceUrl or sourceVideoId")
    });
  });

  it("stores quality video public references as structured reports with declared sources", async () => {
    const missingSource = await jsonFetch(`${baseUrl}/api/asset-library/quality-videos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "缺少来源声明的优质视频",
        sourceUrl: "https://www.instagram.com/reel/quality-missing-source/"
      })
    });
    expect(missingSource.status).toBe(400);
    expect(missingSource.body.error).toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("sourceName")
    });

    const created = await jsonFetch(`${baseUrl}/api/asset-library/quality-videos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "防晒衣爆款公开视频拆解",
        sourceName: "instagram",
        sourceUrl: "https://www.instagram.com/reel/quality-public-001/",
        category: "户外服饰",
        keyword: "防晒衣",
        report: {
          hookMethods: ["开场前 3 秒展示痛点"],
          sellingPoints: ["轻薄", "防晒"],
          storyboard: ["痛点", "上身展示", "场景对比", "CTA"],
          styleTags: ["快节奏", "实拍"]
        }
      })
    });
    expect(created.status).toBe(201);
    expect(created.body.video).toMatchObject({
      title: "防晒衣爆款公开视频拆解",
      status: "ready",
      metadata: {
        libraryKind: "quality-videos",
        sourceDeclaration: {
          sourceName: "instagram",
          sourceUrl: "https://www.instagram.com/reel/quality-public-001/",
          public: true,
          declaredBy: "user"
        },
        compliance: {
          publicVideoOriginalStored: false,
          originalVideoRemixed: false,
          sourceDeclared: true
        },
        qualityReport: {
          hookMethods: ["开场前 3 秒展示痛点"],
          sellingPoints: ["轻薄", "防晒"],
          storyboard: ["痛点", "上身展示", "场景对比", "CTA"],
          styleTags: ["快节奏", "实拍"]
        }
      }
    });
    expect(String(created.body.video.file?.path ?? "")).toBe("");

    const listed = await jsonFetch(`${baseUrl}/api/asset-library/quality-videos?query=防晒衣`);
    expect(listed.status).toBe(200);
    expect((listed.body.videos ?? []).map((video: JsonObject) => video.id)).toContain(created.body.video.id);

    const processPublicReference = await jsonFetch(
      `${baseUrl}/api/asset-library/quality-videos/${created.body.video.id}/process`,
      {
        method: "POST"
      }
    );
    expect(processPublicReference.status).toBe(400);
    expect(processPublicReference.body.error).toMatchObject({
      code: "PUBLIC_ORIGINAL_NOT_STORED"
    });
  });

  it("imports two Bilibili crawler downloads into the commerce video asset library", async () => {
    await jsonFetch(`${baseUrl}/api/connectors/bilibili/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        credentials: {
          cookie: "SESSDATA=test_cookie;",
          userAgent: "Mozilla/5.0",
          accountLabel: "bilibili-user"
        }
      })
    });
    const token = mintConnectorToolToken("connector-bilibili-library-project", "connector-bilibili-library-run");
    const originalCrawlerUrl = process.env.OD_VIDEO_CRAWLER_URL;
    delete process.env.OD_VIDEO_CRAWLER_URL;

    try {
      const search = await jsonFetch(`${baseUrl}/api/tools/connectors/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          connectorId: "bilibili",
          toolName: "bilibili.bilibili_search_videos",
          input: { query: "AI 数字人 带货", limit: 2 }
        })
      });
      const searchItems = Array.isArray(search.body.output?.items) ? search.body.output.items : [];
      const videoIds = searchItems.map((item: JsonObject) => String(item.videoId)).slice(0, 2);

      expect(search.status).toBe(200);
      expect(videoIds).toEqual(["BV1abcde1234", "BV1abcde5678"]);

      const imports: Array<JsonFetchResponse<JsonObject>> = [];
      for (const videoId of videoIds) {
        imports.push(
          await jsonFetch(`${baseUrl}/api/asset-library/commerce-videos/import/crawler`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              connectorId: "bilibili",
              videoId,
              input: { resolution: "1080p" }
            })
          })
        );
      }

      expect(imports.map((response) => response.status)).toEqual([202, 202]);
      expect(new Set(imports.map((response) => response.body.video.id)).size).toBe(2);

      for (const [index, response] of imports.entries()) {
        const videoId = videoIds[index];
        const expectedBody = bilibiliFixtureVideoBytes(videoId);
        const filePath = String(response.body.video.file?.path ?? "");
        const fileResponse = await fetch(`${baseUrl}/api/asset-library/files/${filePath}`);

        expect(response.body.video).toMatchObject({
          sourceKind: "crawler",
          sourceConnectorId: "bilibili",
          sourceVideoId: videoId,
          file: {
            path: expect.stringMatching(/^commerce-videos\//),
            mime: "video/mp4",
            size: expectedBody.byteLength
          },
          metadata: {
            importedBy: "crawler",
            connectorOutput: {
              provider: "bilibili-web",
              savedBytes: expectedBody.byteLength,
              video: { videoId }
            }
          }
        });
        expect(response.body.importJob).toMatchObject({
          kind: "crawler-import",
          status: "done",
          assetId: response.body.video.id
        });
        expect(response.body.job).toMatchObject({
          kind: "process",
          assetId: response.body.video.id
        });
        expect(fileResponse.status).toBe(200);
        expect(Buffer.from(await fileResponse.arrayBuffer())).toEqual(expectedBody);
      }

      const listed = await jsonFetch(`${baseUrl}/api/asset-library/commerce-videos?query=BV1abcde`);
      expect(listed.status).toBe(200);
      expect(listed.body.videos).toEqual(
        expect.arrayContaining(
          imports.map((response) =>
            expect.objectContaining({
              id: response.body.video.id,
              sourceKind: "crawler",
              sourceConnectorId: "bilibili",
              sourceVideoId: response.body.video.sourceVideoId
            })
          )
        )
      );
      expect(lastVideoCrawlerRequest).toBeUndefined();
    } finally {
      if (originalCrawlerUrl === undefined) delete process.env.OD_VIDEO_CRAWLER_URL;
      else process.env.OD_VIDEO_CRAWLER_URL = originalCrawlerUrl;
    }
  });

  it("previews Bilibili search candidates without importing into the commerce video asset library", async () => {
    await jsonFetch(`${baseUrl}/api/connectors/bilibili/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        credentials: {
          cookie: "SESSDATA=test_cookie;",
          userAgent: "Mozilla/5.0",
          accountLabel: "bilibili-user"
        }
      })
    });
    const originalCrawlerUrl = process.env.OD_VIDEO_CRAWLER_URL;
    delete process.env.OD_VIDEO_CRAWLER_URL;

    try {
      const beforeListed = await jsonFetch(`${baseUrl}/api/asset-library/commerce-videos?query=BV1abcde`);
      expect(beforeListed.status).toBe(200);
      const beforeIds = new Set((beforeListed.body.videos ?? []).map((video: JsonObject) => String(video.id)));

      const response = await jsonFetch(`${baseUrl}/api/asset-library/commerce-videos/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectorId: "bilibili",
          query: "AI 数字人 带货",
          limit: 2,
          sort: "hot"
        })
      });

      expect(response.status).toBe(200);
      expect(response.body.search).toMatchObject({
        connectorId: "bilibili",
        provider: "bilibili-web",
        query: "AI 数字人 带货",
        count: 2
      });
      expect(response.body.items).toHaveLength(2);
      expect(response.body.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            videoId: "BV1abcde1234",
            url: "https://www.bilibili.com/video/BV1abcde1234/",
            metrics: expect.objectContaining({ favorite: 3456, comment: 88, danmaku: 321 })
          })
        ])
      );

      const listed = await jsonFetch(`${baseUrl}/api/asset-library/commerce-videos?query=BV1abcde`);
      expect(listed.status).toBe(200);
      expect(new Set((listed.body.videos ?? []).map((video: JsonObject) => String(video.id)))).toEqual(beforeIds);
      expect(
        (listed.body.videos ?? []).filter((video: JsonObject) => video.metadata?.importedBy === "crawler-search")
      ).toEqual([]);
      expect(lastVideoCrawlerRequest).toBeUndefined();
    } finally {
      if (originalCrawlerUrl === undefined) delete process.env.OD_VIDEO_CRAWLER_URL;
      else process.env.OD_VIDEO_CRAWLER_URL = originalCrawlerUrl;
    }
  });

  it("previews Douyin search candidates without importing into the commerce video asset library", async () => {
    await jsonFetch(`${baseUrl}/api/connectors/douyin/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        credentials: {
          cookie: "sessionid=douyin_test_cookie;",
          userAgent: "Mozilla/5.0",
          accountLabel: "douyin-user"
        }
      })
    });
    const originalCrawlerUrl = process.env.OD_VIDEO_CRAWLER_URL;
    delete process.env.OD_VIDEO_CRAWLER_URL;

    try {
      const beforeListed = await jsonFetch(`${baseUrl}/api/asset-library/commerce-videos?query=${DOUYIN_SEARCH_VIDEO_ID}`);
      expect(beforeListed.status).toBe(200);
      const beforeIds = new Set((beforeListed.body.videos ?? []).map((video: JsonObject) => String(video.id)));

      const response = await jsonFetch(`${baseUrl}/api/asset-library/commerce-videos/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectorId: "douyin",
          query: "初春穿搭",
          limit: 2,
          sort: "hot"
        })
      });

      expect(response.status).toBe(200);
      expect(response.body.search).toMatchObject({
        connectorId: "douyin",
        provider: "douyin-web",
        query: "初春穿搭",
        count: 2
      });
      expect(response.body.items).toHaveLength(2);
      expect(response.body.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            videoId: DOUYIN_SEARCH_VIDEO_ID,
            url: `https://www.douyin.com/video/${DOUYIN_SEARCH_VIDEO_ID}`,
            author: "微微爆爆爆",
            metrics: expect.objectContaining({ play: 123456, like: 694, favorite: 42, comment: 33, share: 11 })
          })
        ])
      );
      expect(lastDouyinSearchRequest?.searchParams.get("keyword")).toBe("初春穿搭");
      expect(lastDouyinSearchRequest?.searchParams.get("search_channel")).toBe("aweme_general");

      const listed = await jsonFetch(`${baseUrl}/api/asset-library/commerce-videos?query=${DOUYIN_SEARCH_VIDEO_ID}`);
      expect(listed.status).toBe(200);
      expect(new Set((listed.body.videos ?? []).map((video: JsonObject) => String(video.id)))).toEqual(beforeIds);
      expect(
        (listed.body.videos ?? []).filter((video: JsonObject) => video.metadata?.importedBy === "crawler-search")
      ).toEqual([]);
      expect(lastVideoCrawlerRequest).toBeUndefined();
    } finally {
      if (originalCrawlerUrl === undefined) delete process.env.OD_VIDEO_CRAWLER_URL;
      else process.env.OD_VIDEO_CRAWLER_URL = originalCrawlerUrl;
    }
  });

  it("imports Bilibili search results into the commerce video asset library", async () => {
    await jsonFetch(`${baseUrl}/api/connectors/bilibili/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        credentials: {
          cookie: "SESSDATA=test_cookie;",
          userAgent: "Mozilla/5.0",
          accountLabel: "bilibili-user"
        }
      })
    });
    const originalCrawlerUrl = process.env.OD_VIDEO_CRAWLER_URL;
    delete process.env.OD_VIDEO_CRAWLER_URL;

    try {
      const response = await jsonFetch(`${baseUrl}/api/asset-library/commerce-videos/import/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectorId: "bilibili",
          query: "AI 数字人 带货",
          limit: 2,
          sort: "hot"
        })
      });

      expect(response.status).toBe(201);
      expect(response.body.search).toMatchObject({
        connectorId: "bilibili",
        provider: "bilibili-web",
        query: "AI 数字人 带货",
        count: 2
      });
      expect(response.body.videos).toHaveLength(2);
      expect(response.body.videos).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sourceKind: "crawler",
            sourceConnectorId: "bilibili",
            sourceVideoId: "BV1abcde1234",
            sourceUrl: "https://www.bilibili.com/video/BV1abcde1234/",
            product: {
              subject: "AI 数字人 带货",
              category: "带货视频样本"
            },
            metadata: expect.objectContaining({
              importedBy: "crawler-search",
              crawlerQuery: "AI 数字人 带货",
              metrics: expect.objectContaining({ favorite: 3456, comment: 88, danmaku: 321 }),
              suspectedCommerceEvidence: expect.arrayContaining([expect.stringContaining("带货")]),
              dataLimitations: expect.arrayContaining([expect.stringContaining("公开搜索接口")])
            })
          })
        ])
      );
      expect(response.body.job).toMatchObject({
        kind: "crawler-import",
        status: "done"
      });

      const listed = await jsonFetch(`${baseUrl}/api/asset-library/commerce-videos?query=BV1abcde`);
      expect(listed.status).toBe(200);
      expect(listed.body.videos).toEqual(
        expect.arrayContaining(
          response.body.videos.map((video: JsonObject) =>
            expect.objectContaining({
              id: video.id,
              sourceConnectorId: "bilibili"
            })
          )
        )
      );
      expect(lastVideoCrawlerRequest).toBeUndefined();
    } finally {
      if (originalCrawlerUrl === undefined) delete process.env.OD_VIDEO_CRAWLER_URL;
      else process.env.OD_VIDEO_CRAWLER_URL = originalCrawlerUrl;
    }
  });

  it("imports a public Bilibili 360p crawler test video without cookie credentials", async () => {
    const originalCrawlerUrl = process.env.OD_VIDEO_CRAWLER_URL;
    delete process.env.OD_VIDEO_CRAWLER_URL;

    try {
      const response = await jsonFetch(`${baseUrl}/api/asset-library/commerce-videos/import/crawler`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectorId: "bilibili",
          videoId: "BV1public360",
          publicTest: true,
          input: { resolution: "1080p" }
        })
      });
      const expectedBody = bilibiliFixtureVideoBytes("BV1public360");
      const filePath = String(response.body.video.file?.path ?? "");
      const fileResponse = await fetch(`${baseUrl}/api/asset-library/files/${filePath}`);

      expect(response.status).toBe(202);
      expect(response.body.video).toMatchObject({
        sourceKind: "crawler",
        sourceConnectorId: "bilibili",
        sourceVideoId: "BV1public360",
        metadata: {
          connectorOutput: {
            provider: "bilibili-web",
            publicTest: true,
            selectedQuality: 16,
            selectedResolution: "360P",
            savedBytes: expectedBody.byteLength
          }
        }
      });
      expect(response.body.importJob).toMatchObject({
        kind: "crawler-import",
        status: "done",
        progress: expect.arrayContaining([expect.stringContaining("public 360p test")])
      });
      expect(fileResponse.status).toBe(200);
      expect(Buffer.from(await fileResponse.arrayBuffer())).toEqual(expectedBody);
      const waited = await jsonFetch(`${baseUrl}/api/asset-library/jobs/${response.body.job.id}/wait`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ since: response.body.job.progress.length, timeoutMs: 2_500 })
      });
      expect(waited.body.job).toMatchObject({
        status: "failed",
        error: { code: "NEEDS_VIDEO_FILE" }
      });
      expect(lastVideoCrawlerRequest).toBeUndefined();
    } finally {
      if (originalCrawlerUrl === undefined) delete process.env.OD_VIDEO_CRAWLER_URL;
      else process.env.OD_VIDEO_CRAWLER_URL = originalCrawlerUrl;
    }
  });

  it("imports a public Douyin share video without cookie credentials", async () => {
    const originalCrawlerUrl = process.env.OD_VIDEO_CRAWLER_URL;
    delete process.env.OD_VIDEO_CRAWLER_URL;

    try {
      const response = await jsonFetch(`${baseUrl}/api/asset-library/commerce-videos/import/crawler`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectorId: "douyin",
          url: DOUYIN_SHARE_URL
        })
      });
      const expectedBody = douyinFixtureVideoBytes();
      expect(response.status).toBe(202);
      const filePath = String(response.body.video.file?.path ?? "");
      const fileResponse = await fetch(`${baseUrl}/api/asset-library/files/${filePath}`);

      expect(response.body.video).toMatchObject({
        title: "微微爆爆爆的作品 # 初春穿搭 # 显瘦 # 158小个子穿搭",
        sourceKind: "crawler",
        sourceConnectorId: "douyin",
        sourceUrl: DOUYIN_RESOLVED_URL,
        sourceVideoId: DOUYIN_VIDEO_ID,
        file: {
          path: expect.stringMatching(/^commerce-videos\//),
          mime: "video/mp4",
          size: expectedBody.byteLength
        },
        metadata: {
          importedBy: "crawler",
          connectorOutput: {
            provider: "douyin-public-share",
            source: {
              shareUrl: DOUYIN_SHARE_URL,
              resolvedUrl: DOUYIN_RESOLVED_URL,
              kind: "video"
            },
            video: {
              videoId: DOUYIN_VIDEO_ID,
              url: DOUYIN_RESOLVED_URL,
              title: "微微爆爆爆的作品 # 初春穿搭 # 显瘦 # 158小个子穿搭"
            },
            limitations: expect.arrayContaining([expect.stringContaining("公开分享页")])
          }
        }
      });
      expect(response.body.importJob).toMatchObject({
        kind: "crawler-import",
        status: "done",
        progress: expect.arrayContaining([expect.stringContaining("Douyin public share")])
      });
      expect(fileResponse.status).toBe(200);
      expect(Buffer.from(await fileResponse.arrayBuffer())).toEqual(expectedBody);
      const rangeResponse = await fetch(`${baseUrl}/api/asset-library/files/${filePath}`, {
        headers: { Range: "bytes=0-7" }
      });
      expect(rangeResponse.status).toBe(206);
      expect(rangeResponse.headers.get("accept-ranges")).toBe("bytes");
      expect(rangeResponse.headers.get("content-range")).toBe(`bytes 0-7/${expectedBody.byteLength}`);
      expect(rangeResponse.headers.get("content-length")).toBe("8");
      expect(Buffer.from(await rangeResponse.arrayBuffer())).toEqual(expectedBody.subarray(0, 8));
      const waited = await jsonFetch(`${baseUrl}/api/asset-library/jobs/${response.body.job.id}/wait`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ since: response.body.job.progress.length, timeoutMs: 2_500 })
      });
      expect(["failed", "done"]).toContain(waited.body.job.status);
      expect(lastVideoCrawlerRequest).toBeUndefined();
    } finally {
      if (originalCrawlerUrl === undefined) delete process.env.OD_VIDEO_CRAWLER_URL;
      else process.env.OD_VIDEO_CRAWLER_URL = originalCrawlerUrl;
    }
  });

  it("rejects connector tool requests outside token scope", async () => {
    const listOnlyToken = mintConnectorToolToken("connector-scope-project", "connector-scope-run", {
      allowedEndpoints: ["/api/tools/connectors/list"],
      allowedOperations: ["connectors:list"]
    });

    const execute = await jsonFetch(`${baseUrl}/api/tools/connectors/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${listOnlyToken}` },
      body: JSON.stringify({
        connectorId: "github",
        toolName: "github.github_search_repositories",
        input: { query: "open-design" }
      })
    });

    expect(execute.status).toBe(403);
    expect(execute.body.error.code).toBe("TOOL_ENDPOINT_DENIED");
  });
});
