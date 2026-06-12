import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runAssetsCli } from "../src/asset-library-cli.js";

describe("od assets CLI", () => {
  let stdoutWrite: { mockRestore: () => void };
  let stderrWrite: { mockRestore: () => void };
  let stdoutOutput: string[];
  let stderrOutput: string[];
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    stdoutOutput = [];
    stderrOutput = [];
    stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdoutOutput.push(String(chunk));
      return true;
    });
    stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderrOutput.push(String(chunk));
      return true;
    });
    fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith("/api/asset-library/tool-config")) {
        return jsonResponse({ tools: { ffmpegPath: "C:/tools/ffmpeg.exe", ffprobePath: "", autoDetectEnabled: true } });
      }
      if (url.endsWith("/api/asset-library/embedding-config")) {
        return jsonResponse({
          embedding: { providerId: "volcengine-ark", model: "doubao-embedding", apiKeyConfigured: false }
        });
      }
      if (url.endsWith("/api/asset-library/commerce-videos")) {
        return jsonResponse({
          videos: [
            {
              id: "video-1",
              title: "AI 数字人带货参考",
              status: "ready",
              sourceKind: "crawler",
              sourceConnectorId: "bilibili",
              product: { subject: "AI 数字人", category: "带货视频样本" }
            }
          ]
        });
      }
      if (url.endsWith("/api/asset-library/quality-videos")) {
        return jsonResponse({
          videos: [
            {
              id: "quality-video-1",
              title: "公开视频爆款拆解",
              status: "ready",
              sourceKind: "crawler",
              sourceConnectorId: "instagram",
              product: { subject: "防晒衣", category: "户外服饰" },
              metadata: {
                libraryKind: "quality-videos",
                sourceDeclaration: {
                  sourceName: "instagram",
                  publicSource: true
                }
              }
            }
          ]
        });
      }
      return jsonResponse({ error: `unexpected ${url}` }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    stdoutWrite.mockRestore();
    stderrWrite.mockRestore();
  });

  it("reports aggregate asset-library status as JSON", async () => {
    const result = await runAssetsCli(["status", "--daemon-url", "http://127.0.0.1:17456", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(stderrOutput.join("")).toBe("");
    const body = JSON.parse(stdoutOutput.join(""));
    expect(body).toMatchObject({
      ok: true,
      commerceVideos: {
        count: 1,
        byStatus: { ready: 1 }
      },
      qualityVideos: {
        count: 1,
        byStatus: { ready: 1 }
      }
    });
    expect(body.products).toBeUndefined();
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      "http://127.0.0.1:17456/api/asset-library/tool-config",
      "http://127.0.0.1:17456/api/asset-library/embedding-config",
      "http://127.0.0.1:17456/api/asset-library/commerce-videos",
      "http://127.0.0.1:17456/api/asset-library/quality-videos"
    ]);
  });
});

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
