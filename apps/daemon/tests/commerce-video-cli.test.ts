import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runCommerceVideoCli } from "../src/commerce-video-cli.js";

describe("od commerce-video CLI", () => {
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
    fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/projects/project_1/commerce-video/workflow")) {
        return jsonResponse({
          workflow: {
            projectId: "project_1",
            fileName: "commerce-video.workflow.json",
            stages: []
          }
        });
      }
      if (url.endsWith("/api/projects/project_1/commerce-video/script")) {
        return jsonResponse({
          workflow: {
            projectId: "project_1",
            script: JSON.parse(String(init?.body)).script ?? JSON.parse(String(init?.body))
          }
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

  it("prints workflow JSON for a project", async () => {
    const result = await runCommerceVideoCli([
      "workflow",
      "--project",
      "project_1",
      "--daemon-url",
      "http://127.0.0.1:17456",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    expect(stderrOutput.join("")).toBe("");
    expect(JSON.parse(stdoutOutput.join(""))).toMatchObject({
      workflow: { projectId: "project_1", fileName: "commerce-video.workflow.json" }
    });
  });

  it("accepts script content from --prompt-file stdin-compatible flags", async () => {
    const result = await runCommerceVideoCli([
      "script",
      "--project",
      "project_1",
      "--title",
      "白色牛仔裙",
      "--hook",
      "三秒显瘦",
      "--prompt",
      "高腰 A 字版型，遮胯又显腿长。",
      "--daemon-url",
      "http://127.0.0.1:17456",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody).toMatchObject({
      title: "白色牛仔裙",
      hook: "三秒显瘦",
      voiceover: "高腰 A 字版型，遮胯又显腿长。"
    });
    expect(JSON.parse(stdoutOutput.join(""))).toMatchObject({
      workflow: { script: { title: "白色牛仔裙" } }
    });
  });

  it("requires explicit full automation before generate --follow waits for progress", async () => {
    const result = await runCommerceVideoCli([
      "generate",
      "--project",
      "project_1",
      "--model",
      "doubao-seedance-2-0-260128",
      "--follow",
      "--daemon-url",
      "http://127.0.0.1:17456",
      "--json"
    ]);

    expect(result.exitCode).toBe(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
