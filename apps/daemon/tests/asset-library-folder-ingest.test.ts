import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import { startServer } from "../src/server.js";

type JsonObject = Record<string, any>;
type StartedServer = { url: string; server: Server };

const originalFetch = globalThis.fetch;
const originalMimoApiKey = process.env.MIMO_API_KEY;

let server: Server | undefined;
let tempRoot: string | undefined;

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server?.close((error?: Error) => (error ? reject(error) : resolve()));
    });
  }
  server = undefined;
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = undefined;
  if (originalMimoApiKey === undefined) delete process.env.MIMO_API_KEY;
  else process.env.MIMO_API_KEY = originalMimoApiKey;
  vi.unstubAllGlobals();
});

describe("asset library product folder ingest", () => {
  it("recursively understands, clusters, and imports image files while skipping videos", async () => {
    process.env.MIMO_API_KEY = "mimo_test";
    mockMimoVisionFetch();
    const started = (await startServer({ port: 0, returnServer: true })) as StartedServer;
    server = started.server;
    tempRoot = await mkdtemp(path.join(tmpdir(), "od-product-folder-"));
    const whiteDir = path.join(tempRoot, "white");
    const denimDir = path.join(tempRoot, "denim");
    await mkdir(whiteDir, { recursive: true });
    await mkdir(denimDir, { recursive: true });
    await writeFile(path.join(whiteDir, "white-1.jpg"), "white-dress");
    await writeFile(path.join(denimDir, "denim-1.png"), "denim-skirt-a");
    await writeFile(path.join(denimDir, "denim-2.webp"), "denim-skirt-b");
    await writeFile(path.join(tempRoot, "skip.mp4"), "video");
    await writeFile(path.join(tempRoot, "notes.txt"), "not an image");

    const response = await jsonFetch<JsonObject>(`${started.url}/api/asset-library/products/import/folder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: tempRoot, mode: "parallel", concurrency: 2, processImported: false })
    });

    expect(response.status).toBe(201);
    expect(response.body.scanned.imageCount).toBe(3);
    expect(response.body.imported).toHaveLength(3);
    expect(response.body.failed).toHaveLength(0);
    expect(response.body.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relativePath: "skip.mp4", reason: "video" }),
        expect.objectContaining({ relativePath: "notes.txt", reason: "unsupported" })
      ])
    );
    expect(response.body.clusters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "白色衬衫裙", images: expect.arrayContaining([expect.any(Object)]) }),
        expect.objectContaining({ category: "浅蓝牛仔半身裙", images: expect.arrayContaining([expect.any(Object)]) })
      ])
    );
    const denimCluster = response.body.clusters.find((cluster: JsonObject) => cluster.category === "浅蓝牛仔半身裙");
    expect(denimCluster.images).toHaveLength(2);
    expect(response.body.imported.every((item: JsonObject) => typeof item.productId === "string")).toBe(true);
  });
});

async function jsonFetch<TBody = JsonObject>(url: string, init?: RequestInit) {
  const response = await originalFetch(url, init);
  return { status: response.status, body: (await response.json()) as TBody };
}

function mockMimoVisionFetch() {
  vi.stubGlobal("fetch", async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (!url.includes("api.xiaomimimo.com")) return originalFetch(input, init);
    const body = JSON.parse(String(init?.body ?? "{}"));
    const mediaUrl = body.messages?.[0]?.content?.find((part: JsonObject) => part.type === "image_url")?.image_url?.url;
    const payload = typeof mediaUrl === "string" ? mediaUrl : "";
    const vision = payload.includes(Buffer.from("white-dress").toString("base64"))
      ? {
          subject: "衬衫裙",
          category: "白色衬衫裙",
          productType: "衬衫裙",
          color: "白色",
          pattern: "纯色",
          material: "棉感",
          shape: "衬衫裙",
          sellingPoints: ["清爽白色", "通勤休闲"],
          constraints: [],
          suggestedAngles: ["展示领口和腰线"],
          summary: "白色纯色衬衫裙商品图"
        }
      : {
          subject: "半身裙",
          category: "浅蓝牛仔半身裙",
          productType: "半身裙",
          color: "浅蓝",
          pattern: "牛仔水洗",
          material: "牛仔",
          shape: "半身裙",
          sellingPoints: ["水洗牛仔", "日常百搭"],
          constraints: [],
          suggestedAngles: ["展示裙摆和腰头"],
          summary: "浅蓝牛仔半身裙商品图"
        };
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(vision) }, finish_reason: "stop" }],
        usage: { prompt_tokens: 12, completion_tokens: 24, total_tokens: 36 }
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  });
}
