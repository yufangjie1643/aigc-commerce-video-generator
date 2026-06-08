import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { generateMedia } from "../src/media.js";

const TEST_MINIMAX_BASE_URL = "https://api.minimaxi.com/v1";
const TEST_VOLCENGINE_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const TEST_IMAGE_URL = "https://cdn.example.test/minimax-image.png";
const TEST_VIDEO_URL = "https://cdn.example.test/ark-video.mp4";
const TEST_IMAGE_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
const TEST_VIDEO_BYTES = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);

describe("MiniMax and Volcengine ecommerce media models", () => {
  let root: string;
  let projectRoot: string;
  let projectsRoot: string;
  const realFetch = globalThis.fetch;
  const originalMediaConfigDir = process.env.OD_MEDIA_CONFIG_DIR;
  const originalDataDir = process.env.OD_DATA_DIR;
  const originalVolcenginePollMs = process.env.OD_VOLCENGINE_VIDEO_MAX_POLL_MS;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "od-minimax-volcengine-"));
    projectRoot = path.join(root, "project-root");
    projectsRoot = path.join(projectRoot, ".od", "projects");
    await mkdir(projectsRoot, { recursive: true });
    delete process.env.OD_MEDIA_CONFIG_DIR;
    delete process.env.OD_DATA_DIR;
    delete process.env.OD_MINIMAX_API_KEY;
    delete process.env.MINIMAX_API_KEY;
    delete process.env.OD_VOLCENGINE_API_KEY;
    delete process.env.ARK_API_KEY;
    delete process.env.VOLCENGINE_API_KEY;
    process.env.OD_VOLCENGINE_VIDEO_MAX_POLL_MS = "60000";
  });

  afterEach(async () => {
    globalThis.fetch = realFetch;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    if (originalMediaConfigDir == null) {
      delete process.env.OD_MEDIA_CONFIG_DIR;
    } else {
      process.env.OD_MEDIA_CONFIG_DIR = originalMediaConfigDir;
    }
    if (originalDataDir == null) {
      delete process.env.OD_DATA_DIR;
    } else {
      process.env.OD_DATA_DIR = originalDataDir;
    }
    if (originalVolcenginePollMs == null) {
      delete process.env.OD_VOLCENGINE_VIDEO_MAX_POLL_MS;
    } else {
      process.env.OD_VOLCENGINE_VIDEO_MAX_POLL_MS = originalVolcenginePollMs;
    }
    delete process.env.OD_MINIMAX_API_KEY;
    delete process.env.MINIMAX_API_KEY;
    delete process.env.OD_VOLCENGINE_API_KEY;
    delete process.env.ARK_API_KEY;
    delete process.env.VOLCENGINE_API_KEY;
    await rm(root, { recursive: true, force: true });
  });

  async function writeConfig(data: unknown) {
    const file = path.join(projectRoot, ".od", "media-config.json");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(data), "utf8");
  }

  it("renders MiniMax image-01 through /image_generation and stores downloaded bytes", async () => {
    await writeConfig({
      providers: {
        minimax: {
          apiKey: "minimax-test-key",
          baseUrl: TEST_MINIMAX_BASE_URL
        }
      }
    });

    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === `${TEST_MINIMAX_BASE_URL}/image_generation`) {
        expect(init?.method).toBe("POST");
        expect(init?.headers).toMatchObject({
          authorization: "Bearer minimax-test-key",
          "content-type": "application/json"
        });
        expect(JSON.parse(String(init?.body))).toEqual({
          model: "image-01",
          prompt: "A clean ecommerce hero image for a stainless steel kettle.",
          aspect_ratio: "16:9",
          response_format: "url",
          n: 1,
          prompt_optimizer: false
        });
        return new Response(
          JSON.stringify({
            data: { image_urls: [TEST_IMAGE_URL] },
            base_resp: { status_code: 0, status_msg: "success" }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url === TEST_IMAGE_URL) {
        return new Response(TEST_IMAGE_BYTES, {
          status: 200,
          headers: { "content-type": "image/png" }
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateMedia({
      projectRoot,
      projectsRoot,
      projectId: "project-1",
      surface: "image",
      model: "image-01",
      prompt: "A clean ecommerce hero image for a stainless steel kettle.",
      aspect: "16:9",
      output: "minimax.png"
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.providerId).toBe("minimax");
    expect(result.providerNote).toContain("minimax/image-01");
    expect(result.providerNote).toContain("16:9");
    const bytes = await readFile(path.join(projectsRoot, "project-1", "minimax.png"));
    expect(bytes.equals(TEST_IMAGE_BYTES)).toBe(true);
  });

  it("maps doubao-seedance-1.5-pro to the tested Ark endpoint id", async () => {
    vi.useFakeTimers();
    await writeConfig({
      providers: {
        volcengine: {
          apiKey: "ark-test-key",
          baseUrl: TEST_VOLCENGINE_BASE_URL
        }
      }
    });
    const projectDir = path.join(projectsRoot, "project-1");
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, "reference.png"), TEST_IMAGE_BYTES);

    let createBody: Record<string, unknown> | null = null;
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === `${TEST_VOLCENGINE_BASE_URL}/contents/generations/tasks`) {
        createBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({ id: "ark-task-1" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url === `${TEST_VOLCENGINE_BASE_URL}/contents/generations/tasks/ark-task-1`) {
        return new Response(JSON.stringify({ status: "succeeded", content: { video_url: TEST_VIDEO_URL } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url === TEST_VIDEO_URL) {
        return new Response(TEST_VIDEO_BYTES, {
          status: 200,
          headers: { "content-type": "video/mp4" }
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const resultPromise = generateMedia({
      projectRoot,
      projectsRoot,
      projectId: "project-1",
      surface: "video",
      model: "doubao-seedance-1.5-pro",
      prompt: "A polished kettle launch clip.",
      aspect: "16:9",
      length: 5,
      image: "reference.png",
      output: "ark.mp4"
    });

    await vi.waitFor(() => expect(createBody).not.toBeNull());
    await vi.advanceTimersByTimeAsync(4000);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const result = await resultPromise;

    expect(createBody).toEqual({
      model: "ep-20260514120705-pqv86",
      content: [
        {
          type: "text",
          text: "A polished kettle launch clip. --resolution 720p --duration 5 --ratio 16:9"
        }
      ]
    });
    expect(result.providerId).toBe("volcengine");
    expect(result.providerNote).toContain("volcengine/ep-20260514120705-pqv86");
    const bytes = await readFile(path.join(projectsRoot, "project-1", "ark.mp4"));
    expect(bytes.equals(TEST_VIDEO_BYTES)).toBe(true);
  });
});
